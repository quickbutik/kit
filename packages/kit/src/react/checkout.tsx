"use client";

import {
	type CSSProperties,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import type {
	EmbeddedCheckout,
	EmbeddedCheckoutEventMap,
} from "../sdk/embed/bridge.js";
import {
	type ReturnedCheckout,
	readReturnedCheckout,
	readReturnedSessionId,
	stripReturnedSessionId,
} from "../sdk/embed/return-leg.js";
import { useOptionalAnalytics } from "./analytics.js";
import { useShopkitContext } from "./context.js";

export interface CheckoutProps {
	/**
	 * Where the shopper lands after paying. Relative URLs resolve against this
	 * page, so `"/thanks"` works in every environment.
	 */
	successUrl?: string;
	/** Where the checkout's "back to shop" links point. */
	backUrl?: string;
	/** Checkout UI language (`"sv"`, `"en"`). */
	lang?: string;
	/**
	 * The checkout's theme. Set it when your pages are dark, so the checkout does
	 * not flash white. Omitted, the checkout follows the theme the merchant chose
	 * (live); `"light"` forces light. Read once on mount, like the other session
	 * inputs.
	 */
	theme?: "light" | "dark";
	/**
	 * `"redirect"` (default) navigates to `successUrl` when the order completes;
	 * `"inline"` stays here and lets the frame render its own confirmation.
	 */
	confirmation?: "redirect" | "inline";
	/** Height before the frame reports its own, and the floor it never goes below. */
	minHeight?: number;
	className?: string;
	style?: CSSProperties;
	onReady?: (detail: EmbeddedCheckoutEventMap["ready"]) => void;
	onStep?: (detail: EmbeddedCheckoutEventMap["step"]) => void;
	/** GA4-shaped commerce events, for your own dataLayer or pixel. */
	onEvent?: (detail: EmbeddedCheckoutEventMap["event"]) => void;
	onComplete?: (detail: EmbeddedCheckoutEventMap["complete"]) => void;
	onError?: (detail: EmbeddedCheckoutEventMap["error"]) => void;
	/**
	 * The checkout is not being embedded — the shop cannot be, or the frame
	 * never answered (`reason: "handshake-timeout"`) — and the shopper is being
	 * sent to the hosted checkout at `detail.url` instead.
	 */
	onFallback?: (detail: EmbeddedCheckoutEventMap["fallback"]) => void;
	/**
	 * Called once when the cart settles empty (on load, or after the page empties
	 * it); no checkout is mounted until items arrive. Render your own "your cart
	 * is empty" from it.
	 */
	onEmpty?: () => void;
}

/**
 * The Quickbutik checkout, inside your own page.
 *
 * ```tsx
 * <Checkout successUrl="/thanks" backUrl="/cart" onComplete={celebrate} />
 * ```
 *
 * Renders one `<div>` and lets `checkout.mount()` put the frame inside it. The
 * session is created once, from the props at mount: changing `successUrl`
 * later does not rebuild it, since that would discard a payment in progress.
 * Handlers are read live, so inline arrows are fine.
 *
 * It follows the cart like `<qb-checkout>`: nothing is mounted while the cart
 * is loading or empty (`onEmpty` fires once), cart changes made from the page
 * re-price the live checkout, and emptying the cart takes the frame down; the
 * next item added starts a fresh session.
 *
 * Redirect payment methods are handled for you: when the page loads with
 * `?qb_checkout_session=` and `qb_checkout_shop=`, the component resumes that
 * session whatever the cart's state, and strips the parameters once the
 * resumed frame is ready.
 */
export function Checkout({
	successUrl,
	backUrl,
	lang,
	theme,
	confirmation,
	minHeight,
	className,
	style,
	...handlers
}: CheckoutProps) {
	const { client, cartStore } = useShopkitContext();
	const container = useRef<HTMLDivElement | null>(null);

	// Latest-ref for the callbacks: they are almost always inline arrows, and a
	// new identity per render must not tear down and re-create a live checkout.
	const latest = useRef(handlers);
	latest.current = handlers;

	// Frame events also go to the analytics hub, through a ref so the mount
	// effect does not depend on it.
	const hub = useOptionalAnalytics();
	const analytics = useRef(hub);
	analytics.current = hub;

	// Session inputs are captured on mount, so they are read through a ref
	// rather than named as dependencies.
	const inputs = useRef({
		successUrl,
		backUrl,
		lang,
		theme,
		confirmation,
		minHeight,
	});
	inputs.current = {
		successUrl,
		backUrl,
		lang,
		theme,
		confirmation,
		minHeight,
	};

	/**
	 * The session a redirect payment method came back with, read once per
	 * instance. The parameters stay on the URL until the resumed frame is ready,
	 * so a failed resume can be reloaded; the ref keeps a later effect re-run on
	 * the same session after they are stripped. `undefined` means not read yet;
	 * on the server it is null.
	 */
	const returned = useRef<ReturnedCheckout | null | undefined>(undefined);
	if (returned.current === undefined) {
		returned.current =
			typeof window === "undefined" ? null : readReturnedCheckout();
	}

	// Loaded, never created here: an empty checkout page must not create a cart.
	const cart = useSyncExternalStore(
		cartStore.subscribe,
		cartStore.getSnapshot,
		cartStore.getSnapshot,
	);
	useEffect(() => {
		void cartStore.load();
	}, [cartStore]);

	/**
	 * Set on `complete`, so the cart emptying once the order exists does not
	 * tear down an inline receipt.
	 */
	const completed = useRef(false);

	/**
	 * The live handle, and the cart revision it has already been told about.
	 * Baselined when a mount starts, so a cart change landing during `mount()`
	 * is left for the `ready` handler to send.
	 */
	const liveHandle = useRef<EmbeddedCheckout | null>(null);
	const sentRevision = useRef(0);
	const revision = useRef(cart.revision);
	revision.current = cart.revision;

	const hasItems = cart.status === "ready" && cart.itemCount > 0;
	const settledEmpty = cart.status === "ready" && cart.itemCount === 0;
	/**
	 * Whether a frame belongs on the page right now. A return leg and a
	 * completed order want one whatever the cart says; otherwise it is the
	 * cart's call, and "still loading" is a no.
	 */
	const wantsCheckout =
		returned.current !== null || completed.current || hasItems;

	/** Once per empty phase, as `<qb-checkout>` emits `qb:checkout-empty`. */
	const announcedEmpty = useRef(false);
	useEffect(() => {
		if (!settledEmpty) {
			announcedEmpty.current = false;
			return;
		}
		if (wantsCheckout || announcedEmpty.current) return;
		announcedEmpty.current = true;
		latest.current.onEmpty?.();
	}, [settledEmpty, wantsCheckout]);

	/**
	 * One in-flight `mount()`/`resume()` per instance, keyed on the client.
	 * StrictMode's second effect run joins the first run's promise rather than
	 * starting a second handoff. `holders` counts runs not yet cleaned up, so a
	 * handle resolving after a real unmount is destroyed rather than orphaned.
	 */
	const pending = useRef<{
		client: typeof client;
		promise: Promise<EmbeddedCheckout>;
	} | null>(null);
	const holders = useRef(0);

	useEffect(() => {
		const target = container.current;
		if (!target) return;

		if (!wantsCheckout) {
			// Nothing to show. Drop a `mount()` still in flight for a cart that is
			// gone, so the next run starts fresh instead of joining it.
			pending.current = null;
			return;
		}

		holders.current++;
		let live = true;
		let handle: EmbeddedCheckout | null = null;
		const resume = returned.current;
		// Before the mount, so a change made while it is in flight survives to
		// the `ready` below (see `sentRevision`).
		sentRevision.current = revision.current;

		if (pending.current?.client !== client) {
			pending.current = {
				client,
				promise: resume
					? client.checkout.resume(target, resume.sessionId, {
							storeId: resume.storeId,
							successUrl: absolute(inputs.current.successUrl),
							language: inputs.current.lang,
							confirmation: inputs.current.confirmation,
							minHeight: inputs.current.minHeight,
						})
					: client.checkout.mount(target, {
							successUrl:
								absolute(inputs.current.successUrl) ?? window.location.href,
							backUrl: absolute(inputs.current.backUrl),
							language: inputs.current.lang,
							theme: inputs.current.theme,
							confirmation: inputs.current.confirmation,
							minHeight: inputs.current.minHeight,
						}),
			};
		}
		const started = pending.current.promise;
		const release = (): void => {
			if (pending.current?.promise === started) pending.current = null;
		};

		void (async () => {
			try {
				const mounted = await started;
				if (!live) {
					// Cleaned up mid-mount. A later run holding the same promise shows the
					// handle; if none does, destroy it here.
					if (holders.current === 0 || pending.current?.promise !== started) {
						mounted.destroy();
						release();
					}
					return;
				}
				handle = mounted;
				liveHandle.current = mounted;
				mounted.on("ready", (detail) => {
					// Strip the return parameters only once the resumed session is ready.
					if (readReturnedSessionId() === mounted.sessionId) {
						stripReturnedSessionId();
					}
					// A cart change that landed while mounting; the frame does not re-read
					// the cart on its own.
					if (sentRevision.current !== revision.current) {
						sentRevision.current = revision.current;
						mounted.cartUpdated();
					}
					latest.current.onReady?.(detail);
				});
				mounted.on("step", (detail) => latest.current.onStep?.(detail));
				mounted.on("event", (detail) => {
					analytics.current?.track(detail);
					latest.current.onEvent?.(detail);
				});
				mounted.on("complete", (detail) => {
					completed.current = true;
					latest.current.onComplete?.(detail);
				});
				mounted.on("demo-complete", () => {
					completed.current = true;
				});
				mounted.on("error", (detail) => latest.current.onError?.(detail));
				mounted.on("fallback", (detail) => latest.current.onFallback?.(detail));
			} catch (cause) {
				release();
				if (!live) return;
				// Reported, never thrown: a throw here would take the whole page down
				// unless the app has an error boundary.
				const message = cause instanceof Error ? cause.message : String(cause);
				console.error(
					"shopkit: <Checkout> could not start the checkout",
					cause,
				);
				latest.current.onError?.({ code: "unknown", message, fatal: true });
			}
		})();

		return () => {
			live = false;
			holders.current--;
			if (handle) {
				// Unmount, or the cart emptied under a live frame. `wantsCheckout`
				// decides whether a fresh session follows.
				if (liveHandle.current === handle) liveHandle.current = null;
				handle.destroy();
				release();
			}
		};
	}, [client, wantsCheckout]);

	/**
	 * Tell the frame when this page changes the cart. Declared after the mount
	 * effect on purpose: React runs every cleanup before any effect body, so a
	 * `clear()` has already taken the frame down and finds no handle here.
	 */
	useEffect(() => {
		const handle = liveHandle.current;
		if (!handle) return;
		if (sentRevision.current === cart.revision) return;
		sentRevision.current = cart.revision;
		handle.cartUpdated();
	}, [cart.revision]);

	return <div ref={container} className={className} style={style} />;
}

/** A relative `successUrl="/thanks"`, resolved the way the elements resolve it. */
function absolute(url: string | undefined): string | undefined {
	if (url === undefined) return undefined;
	try {
		return new URL(url, window.location.href).toString();
	} catch {
		return url;
	}
}
