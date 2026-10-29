"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutHandoffUrl } from "../analytics/handoff.js";
import type {
	StartCheckoutInput,
	StartCheckoutResult,
} from "../sdk/resources/checkout.js";
import type { AddCartItemInput } from "../sdk/types/cart.js";
import type {
	ConfirmationOutcome,
	ConfirmationStatus,
	SessionConfirmation,
} from "../sdk/types/checkout.js";
import { releaseOnRestore } from "../state/navigation-hold.js";
import { reportPurchase, useOptionalAnalytics } from "./analytics.js";
import { useOptionalConsentStore } from "./consent.js";
import { useShopkitContext } from "./context.js";

export interface UseCheckoutResult {
	/**
	 * Create the session and return the hosted checkout URL. Does NOT navigate —
	 * see {@link redirectToCheckout} for that.
	 */
	start: (input: StartCheckoutInput) => Promise<StartCheckoutResult | null>;
	/** Create the session and navigate the browser to the hosted checkout. */
	redirectToCheckout: (input: StartCheckoutInput) => Promise<void>;
	/**
	 * Add one product to the remembered cart and go straight to the hosted
	 * checkout — the "Köp nu" button. Navigates like {@link redirectToCheckout};
	 * an existing basket is carried along, not replaced.
	 *
	 * Inside a `<ProductProvider>`, `useProductAddToCart().buyNow` is the
	 * variant-aware version of this.
	 */
	buyNow: (item: AddCartItemInput, input: StartCheckoutInput) => Promise<void>;
	/**
	 * True while the session is being created — and, after
	 * `redirectToCheckout` or `buyNow` has navigated, until the page is
	 * restored from the back/forward cache, so a click while the checkout
	 * loads does nothing.
	 */
	starting: boolean;
	error: Error | null;
	/** The URL from the last successful `start`. */
	url: string | null;
}

/**
 * Hand the shopper off to the hosted Quickbutik checkout.
 *
 * ```tsx
 * const { redirectToCheckout, starting } = useCheckout()
 * <button
 *   disabled={starting}
 *   onClick={() =>
 *     redirectToCheckout({
 *       successUrl: `${location.origin}/order`,
 *       backUrl: `${location.origin}/`,
 *     })
 *   }
 * >
 *   Till kassan
 * </button>
 * ```
 */
export function useCheckout(): UseCheckoutResult {
	const { client, cartStore } = useShopkitContext();
	const consent = useOptionalConsentStore();
	const analytics = useOptionalAnalytics();
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [url, setUrl] = useState<string | null>(null);
	// Double-click guard: a second redirect would race the first.
	const inFlight = useRef(false);

	/**
	 * The checkout URL with the shopper's consent (and GA session link) on it,
	 * so the checkout tracks only what this page was allowed to.
	 */
	const decorate = useCallback(
		(target: string): string =>
			client.consent.enabled
				? checkoutHandoffUrl(target, consent, analytics)
				: target,
		[client, consent, analytics],
	);

	const start = useCallback(
		async (input: StartCheckoutInput): Promise<StartCheckoutResult | null> => {
			if (inFlight.current) return null;
			inFlight.current = true;
			setStarting(true);
			setError(null);
			try {
				const result = await client.checkout.start(input);
				const decorated = { ...result, url: decorate(result.url) };
				setUrl(decorated.url);
				return decorated;
			} catch (cause) {
				setError(cause instanceof Error ? cause : new Error(String(cause)));
				return null;
			} finally {
				inFlight.current = false;
				setStarting(false);
			}
		},
		[client, decorate],
	);

	// After a navigating handoff, stay `starting` until the page is restored
	// from the bfcache, so a click while navigation commits does nothing.
	const holdForNavigation = useCallback((): void => {
		inFlight.current = true;
		setStarting(true);
		releaseOnRestore(() => {
			inFlight.current = false;
			setStarting(false);
		});
	}, []);

	const redirectToCheckout = useCallback(
		async (input: StartCheckoutInput): Promise<void> => {
			const result = await start(input);
			if (!result) return;
			// `assign`, not `replace`: the shopper's back button should return them to
			// the cart, which is where they came from.
			window.location.assign(result.url);
			holdForNavigation();
		},
		[start, holdForNavigation],
	);

	const buyNow = useCallback(
		async (
			item: AddCartItemInput,
			input: StartCheckoutInput,
		): Promise<void> => {
			// Same double-click guard as `start`.
			if (inFlight.current) return;
			inFlight.current = true;
			setStarting(true);
			setError(null);
			try {
				// Through the shared store, so a page that is not left behind (a blocked
				// navigation, a bfcache restore) shows the added item.
				const result = await cartStore.buyNow(item, input);
				const target = decorate(result.url);
				setUrl(target);
				window.location.assign(target);
				holdForNavigation();
				return;
			} catch (cause) {
				setError(cause instanceof Error ? cause : new Error(String(cause)));
			}
			inFlight.current = false;
			setStarting(false);
		},
		[cartStore, holdForNavigation, decorate],
	);

	return { start, redirectToCheckout, buyNow, starting, error, url };
}

export interface UseOrderConfirmationOptions {
	/** Default true. False never polls (a settled `initialConfirmation` never does either). */
	enabled?: boolean;
	/** Report the `purchase` event once the order exists. Default true. */
	trackPurchase?: boolean;
	/**
	 * The snapshot the server already took (`shopkit.checkout.confirmation()`).
	 * `completed` or `failed` is final: no polling, and a completed one is
	 * reported as the `purchase`.
	 */
	initialConfirmation?: SessionConfirmation | null;
}

/** A terminal snapshot as the outcome a poll would have ended in; else null. */
function settledOutcome(
	confirmation: SessionConfirmation | null,
): ConfirmationOutcome | null {
	if (confirmation?.status === "completed") {
		return {
			kind: "completed",
			orderNumber: confirmation.orderNumber ?? null,
			confirmation,
		};
	}
	if (confirmation?.status === "failed")
		return { kind: "failed", confirmation };
	return null;
}

export interface UseOrderConfirmationResult {
	status: ConfirmationStatus | null;
	orderNumber: number | null;
	/** Set once polling reaches a terminal state (or gives up). */
	outcome: ConfirmationOutcome | null;
	/** The most recent raw snapshot from the server. */
	confirmation: SessionConfirmation | null;
	/** True while still polling. */
	loading: boolean;
	error: Error | null;
}

/**
 * Poll a checkout session until its order exists — the thank-you page hook.
 *
 * Order creation is asynchronous after payment, so this polls with backoff and
 * settles on `completed`, `failed` or `timeout`. Pass a session id, or omit it
 * to use the one remembered when the session was created.
 *
 * ```tsx
 * const { status, orderNumber, loading } = useOrderConfirmation()
 * if (loading) return <Spinner label="Skapar din order…" />
 * if (status === "completed") return <ThankYou orderNumber={orderNumber} />
 * ```
 *
 * Pass a snapshot taken on the server (`shopkit.checkout.confirmation()`) as
 * `initialConfirmation`: a terminal one is returned from the first render
 * with no polling; anything else is where polling starts.
 *
 * Inside an analytics hub (on by default under `<ShopkitProvider>`) a
 * completed order is reported as a `purchase` event, once per browser. Not
 * with `trackPurchase: false`, nor in `inline` success mode, where the
 * embedded checkout reports it. The legacy checkout has no session to build
 * from; call `useAnalytics().trackPurchase()` there.
 */
export function useOrderConfirmation(
	sessionId?: string | null,
	options: UseOrderConfirmationOptions = {},
): UseOrderConfirmationResult {
	const { client } = useShopkitContext();
	const analytics = useOptionalAnalytics();
	const initial = options.initialConfirmation ?? null;
	// A terminal server snapshot is the answer; nothing to poll. Read once.
	const [settled] = useState<ConfirmationOutcome | null>(() =>
		settledOutcome(initial),
	);
	const enabled = (options.enabled ?? true) && settled === null;
	const trackPurchase = options.trackPurchase ?? true;
	const [confirmation, setConfirmation] = useState<SessionConfirmation | null>(
		initial,
	);
	const [outcome, setOutcome] = useState<ConfirmationOutcome | null>(settled);
	const [loading, setLoading] = useState(enabled);
	const [error, setError] = useState<Error | null>(null);
	/**
	 * Captured before the poll completes: a completed poll forgets the
	 * remembered session and store ids the purchase is built from.
	 */
	const polled = useRef<{
		sessionId: string | null;
		storeId: string | null;
	} | null>(null);

	useEffect(() => {
		if (!enabled) {
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		let active = true;

		void (async () => {
			try {
				// Read once, here: a completed poll clears the remembered id.
				const resolved =
					sessionId ?? (await client.checkout.currentSessionId());
				if (!active) return;
				if (!resolved) {
					setLoading(false);
					setError(
						new Error(
							"shopkit: no checkout session to confirm. Pass a sessionId, or " +
								"make sure the session was created through shopkit.",
						),
					);
					return;
				}
				polled.current = {
					sessionId: resolved,
					storeId: client.checkout.rememberedStoreId(),
				};
				const result = await client.checkout.pollConfirmation(resolved, {
					signal: controller.signal,
					onUpdate: (snapshot) => {
						if (active) setConfirmation(snapshot);
					},
				});
				if (!active) return;
				setOutcome(result);
				setLoading(false);
			} catch (cause) {
				if (!active) return;
				setError(cause instanceof Error ? cause : new Error(String(cause)));
				setLoading(false);
			}
		})();

		return () => {
			active = false;
			controller.abort();
		};
	}, [client, sessionId, enabled]);

	/**
	 * The settled path's bookkeeping, done once: capture the session and store id
	 * for the purchase, then `finalize()` so the next checkout starts fresh.
	 */
	const [settledSource, setSettledSource] = useState<{
		sessionId: string | null;
		storeId: string | null;
	} | null>(null);
	const finalized = useRef(false);
	useEffect(() => {
		if (settled?.kind !== "completed" || finalized.current) return;
		finalized.current = true;
		void (async () => {
			// Each step is caught on its own: the purchase never depends on the
			// bookkeeping. The store id first, since `finalize()` forgets it.
			let storeId: string | null = null;
			try {
				storeId = client.checkout.rememberedStoreId();
			} catch (cause) {
				console.warn("shopkit: could not read the shop's store id", cause);
			}
			let id = sessionId ?? null;
			if (id === null) {
				try {
					id = await client.checkout.currentSessionId();
				} catch (cause) {
					console.warn("shopkit: could not read the checkout session", cause);
				}
			}
			setSettledSource({ sessionId: id, storeId });
			try {
				await client.checkout.finalize();
			} catch (cause) {
				console.warn("shopkit: could not forget the completed checkout", cause);
			}
		})();
	}, [client, settled, sessionId]);

	// Its own effect, keyed on the outcome, so toggling tracking never restarts
	// the poll.
	const reported = useRef<string | null>(null);
	useEffect(() => {
		if (!trackPurchase || !analytics || outcome?.kind !== "completed") return;
		const orderNumber = outcome.orderNumber;
		// Captured before the poll, or by the settled-path effect above.
		const source =
			polled.current ?? (outcome === settled ? settledSource : null);
		if (orderNumber == null || !source) return;
		// The embedded frame fires `purchase` itself in inline mode; firing it
		// here too would count the order twice.
		if (outcome.confirmation.successMode === "inline") return;
		// One attempt per order, StrictMode double effects included.
		const key = String(orderNumber);
		if (reported.current === key) return;
		reported.current = key;
		reportPurchase(client, analytics, {
			sessionId: source.sessionId,
			orderNumber,
			storeId: source.storeId,
		}).catch((cause: unknown) => {
			// Reported, never thrown: a thank-you page must not fail over tracking.
			console.warn("shopkit: the purchase was not tracked", cause);
		});
	}, [client, analytics, outcome, trackPurchase, settled, settledSource]);

	return {
		status: confirmation?.status ?? null,
		orderNumber:
			(outcome?.kind === "completed" ? outcome.orderNumber : null) ??
			confirmation?.orderNumber ??
			null,
		outcome,
		confirmation,
		loading,
		error,
	};
}
