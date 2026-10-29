"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Analytics } from "../analytics/analytics.js";
import type { AnalyticsDestination } from "../analytics/destination.js";
import { purchaseFromSession } from "../analytics/events.js";
import { destinationsFromShop } from "../analytics/from-shop.js";
import type { ConsentStore } from "../consent/store.js";
import type { ShopkitClient } from "../sdk/client.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import type { Shop } from "../sdk/types/shop.js";
import { useOptionalConsentStore } from "./consent.js";
import { useShopkitContext } from "./context.js";

export const AnalyticsContext = createContext<Analytics | null>(null);

export interface AnalyticsProviderProps {
	children: ReactNode;
	/**
	 * Destinations of your own, on top of (or instead of) the shop's. The kit
	 * ships `googleTagDestination` and `metaPixelDestination`; anything else is
	 * one object implementing `AnalyticsDestination`.
	 */
	destinations?: AnalyticsDestination[];
	/**
	 * Load the merchant's GA4 / GTM / Meta Pixel from the shop's tracking
	 * configuration (`GET /checkout/shop`). Default true. Set false when you
	 * configure every destination yourself.
	 */
	auto?: boolean;
	/**
	 * False runs analytics (and the hosted checkout's tracking) without consent;
	 * only for a storefront certain it owes its shoppers none. Default true:
	 * without a `<ConsentProvider>` nothing is sent, and one warning says so.
	 */
	requireConsent?: boolean;
	/** The currency for events that carry none. Falls back to the cart's. */
	currency?: string;
	/** The shop's numeric store id, for the purchase dedup key and Meta eventID. */
	storeId?: string | number | null;
	/** How many events are remembered for destinations not ready for them yet. Default 50, minimum 1. */
	bufferSize?: number;
	/** Log every dispatch to the console. */
	debug?: boolean;
	/**
	 * Load GTM / gtag.js before the shopper decides, in Consent Mode denied.
	 * Default false: nothing from Google loads until `analytics` is granted.
	 * Note that a GTM container loaded this way runs all of its tags.
	 */
	loadBeforeConsent?: boolean;
}

/**
 * Analytics and pixels for the tree below, gated on the shopper's consent.
 *
 * Needs a shop context and a consent provider above it. The product, search,
 * cart, checkout and confirmation surfaces report into it on their own;
 * `useAnalytics()` is for everything else.
 *
 * ```tsx
 * <ConsentProvider>
 *   <ShopkitProvider config={config}>
 *     <AnalyticsProvider>{children}</AnalyticsProvider>
 *   </ShopkitProvider>
 * </ConsentProvider>
 * ```
 *
 * With `auto` (the default) the merchant's GA4, GTM and Meta ids are read from
 * the shop, the same ones the hosted checkout loads. Google loads once
 * `analytics` is granted and Meta on `marketing`; `loadBeforeConsent` loads
 * Google earlier, in Consent Mode denied.
 *
 * `<ShopkitProvider>` mounts one by default (see its `consent` prop). One
 * rendered inside an existing hub for the same shop joins it: its
 * `destinations` are added and the pixels are not loaded twice.
 */
export function AnalyticsProvider(props: AnalyticsProviderProps): ReactNode {
	const outer = useContext(AnalyticsContext);
	const { client } = useShopkitContext();
	// One hub per shop per page tree: a second would load the same tags again
	// and count every event twice.
	if (outer && hubShops.get(outer) === client.shopPrefix) {
		return <JoinedAnalytics hub={outer} {...props} />;
	}
	return <OwnAnalyticsProvider {...props} />;
}

/** Which shop (key prefix) each provider-built hub reports for. */
const hubShops = new WeakMap<Analytics, string>();

/**
 * Whether `hub` is the hub of the shop `client` sells for, so a nested
 * provider may share it. @internal
 */
export function isHubFor(hub: Analytics, client: ShopkitClient): boolean {
	return hubShops.get(hub) === client.shopPrefix;
}

/**
 * An `<AnalyticsProvider>` below an existing hub: its `destinations` are added
 * to that hub while mounted, and build-only options are reported as ignored.
 *
 * Destinations are matched across renders by `key`, else by identity, so an
 * inline array of unchanged destinations is not re-added (which would load the
 * vendor again and replay the hub's history into it).
 */
function JoinedAnalytics({
	hub,
	children,
	destinations,
	...options
}: AnalyticsProviderProps & { hub: Analytics }): ReactNode {
	const mounted = useRef(new Map<string, AnalyticsDestination>());
	useEffect(() => {
		const current = mounted.current;
		const wanted = new Map<string, AnalyticsDestination>();
		for (const destination of destinations ?? []) {
			const key = instanceKey(destination);
			if (!wanted.has(key)) wanted.set(key, destination);
		}
		for (const [key, destination] of current) {
			if (!wanted.has(key)) {
				hub.removeDestination(destination);
				current.delete(key);
			}
		}
		for (const [key, destination] of wanted) {
			if (current.has(key)) continue;
			current.set(key, destination);
			hub.addDestination(destination);
		}
	});
	useEffect(
		() => () => {
			for (const destination of mounted.current.values()) {
				hub.removeDestination(destination);
			}
			mounted.current.clear();
		},
		[hub],
	);
	const ignored = Object.entries(options)
		.filter(([key, value]) => value !== undefined && !(key === "auto" && value))
		.map(([key]) => key);
	const warned = useRef(false);
	useEffect(() => {
		if (ignored.length === 0 || warned.current) return;
		warned.current = true;
		console.warn(
			`shopkit: this <AnalyticsProvider> sits inside another analytics hub ` +
				`(the one <ShopkitProvider> mounts by default) and joins it, so ` +
				`${ignored.map((key) => `\`${key}\``).join(", ")} ` +
				"cannot apply. Pass them as `consent={{ analytics: { … } }}` on " +
				"<ShopkitProvider>, or set `consent={{ analytics: false }}` there " +
				"and keep this provider.",
		);
	});
	return children;
}

/** Keys for destinations that carry none: one per object. */
const objectKeys = new WeakMap<AnalyticsDestination, string>();
let objectKeyCount = 0;

function instanceKey(destination: AnalyticsDestination): string {
	if (destination.key) return destination.key;
	let key = objectKeys.get(destination);
	if (!key) {
		key = `#${++objectKeyCount}`;
		objectKeys.set(destination, key);
	}
	return key;
}

function OwnAnalyticsProvider({
	children,
	destinations,
	auto = true,
	requireConsent,
	currency,
	storeId,
	bufferSize,
	debug,
	loadBeforeConsent,
}: AnalyticsProviderProps): ReactNode {
	const { client, cartStore } = useShopkitContext();
	// Read when the shop's ids arrive, not as effect dependencies: an inline
	// option change must not refetch the shop.
	const shopOptions = useRef({ loadBeforeConsent });
	shopOptions.current = { loadBeforeConsent };
	// Unsubscribed: the hub subscribes to the store itself.
	const consent = useOptionalConsentStore();

	// One hub per (client, consent store): a hub rebuilt on every render would
	// forget the events it holds for a shopper who has not decided yet.
	const created = useRef<{
		client: ShopkitClient;
		consent: ConsentStore | null;
		hub: Analytics;
	} | null>(null);
	if (
		!created.current ||
		created.current.client !== client ||
		created.current.consent !== consent
	) {
		const built = {
			client,
			consent,
			hub: new Analytics({
				destinations,
				consent,
				requireConsent,
				currency,
				storeId,
				bufferSize,
				debug,
			}),
		};
		hubShops.set(built.hub, client.shopPrefix);
		created.current = built;
	}
	const hub = created.current.hub;

	// The shop is read once per client (a StrictMode double effect costs one
	// request), and its destinations are added once per hub, so toggling `auto`
	// cannot add Google and Meta twice. A failed read is retried on a later mount.
	const shopRequest = useRef<{
		client: ShopkitClient;
		promise: Promise<Shop>;
	} | null>(null);
	const autoAddedTo = useRef<Analytics | null>(null);
	const warnedNoTracking = useRef(false);

	useEffect(() => {
		let active = true;
		// Both idempotent, so safe on every mount. `destroy()` is never called:
		// StrictMode's simulated unmount would wipe the events held for consent.
		hub.start();
		const detach = hub.attachCart(cartStore);

		if (auto) {
			if (shopRequest.current?.client !== client) {
				shopRequest.current = { client, promise: client.shop.get() };
			}
			const request = shopRequest.current;
			request.promise
				.then((shop) => {
					if (!active || autoAddedTo.current === hub) return;
					autoAddedTo.current = hub;
					const found = destinationsFromShop(
						shop.tracking,
						shopOptions.current,
					);
					if (found.length === 0 && !warnedNoTracking.current) {
						warnedNoTracking.current = true;
						console.warn(
							"shopkit: analytics is on but this shop has no GA4, GTM or " +
								"Meta pixel configured, so only the destinations passed to " +
								"<AnalyticsProvider> (if any) receive events. Add the ids " +
								"under tracking in the Quickbutik admin, or pass " +
								"`destinations` yourself.",
						);
					}
					for (const destination of found) hub.addDestination(destination);
				})
				.catch((error: unknown) => {
					if (shopRequest.current === request) shopRequest.current = null;
					if (!active) return;
					console.warn(
						"shopkit: analytics could not read the shop's tracking " +
							"configuration, so the merchant's GA4 / GTM / Meta pixel were " +
							"not loaded.",
						error,
					);
				});
		}

		return () => {
			active = false;
			detach();
			hub.stop();
		};
	}, [hub, cartStore, client, auto]);

	return (
		<AnalyticsContext.Provider value={hub}>
			{children}
		</AnalyticsContext.Provider>
	);
}

/**
 * The analytics hub. Throws outside an `<AnalyticsProvider>`.
 *
 * ```tsx
 * const analytics = useAnalytics()
 * analytics.track(viewItemListEvent(items, "Nyheter"))
 * ```
 */
export function useAnalytics(): Analytics {
	const hub = useContext(AnalyticsContext);
	if (!hub) {
		throw new ShopkitConfigError(
			"shopkit: no <AnalyticsProvider> above this component. Render one " +
				"inside <ShopkitProvider> to turn analytics on.",
		);
	}
	return hub;
}

/** The hub, or null when there is no `<AnalyticsProvider>` above. */
export function useOptionalAnalytics(): Analytics | null {
	return useContext(AnalyticsContext);
}

export interface UseTrackPurchaseInput {
	/**
	 * The checkout session the order came from. Defaults to the one the kit
	 * remembered when the session was created. Pass it explicitly when
	 * `useOrderConfirmation` runs on the same page: its completed poll forgets
	 * the remembered session.
	 */
	sessionId?: string | null;
	/** The order number. Nothing happens until it is known. */
	orderNumber: string | number | null | undefined;
	/** Default true. */
	enabled?: boolean;
	/** GA4 `affiliation` — the store the order was placed with. */
	affiliation?: string | null;
}

export interface UseTrackPurchaseResult {
	/**
	 * True once the purchase has been handed to analytics, by this hook or by an
	 * earlier page load in this browser.
	 */
	tracked: boolean;
	/** Why it could not be tracked, or null. Never thrown. */
	error: Error | null;
}

/**
 * Report the `purchase` event from a thank-you page of your own.
 *
 * `useOrderConfirmation` does this for you; use this when you confirm the
 * order some other way. The purchase is built from the checkout session and
 * deduplicated per browser, so a reload does not count the order twice.
 *
 * ```tsx
 * const { tracked, error } = useTrackPurchase({ orderNumber, sessionId })
 * ```
 *
 * Does nothing without an `<AnalyticsProvider>` above or an order number. A
 * session with no order data sets `error`; call
 * `useAnalytics().trackPurchase()` yourself then.
 */
export function useTrackPurchase(
	input: UseTrackPurchaseInput,
): UseTrackPurchaseResult {
	const { client } = useShopkitContext();
	const analytics = useOptionalAnalytics();
	const { sessionId, orderNumber, enabled = true, affiliation } = input;
	const [tracked, setTracked] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	/**
	 * One attempt per order number, shared by every effect run: under StrictMode
	 * each run attaches to the same promise, and whichever is still live when it
	 * settles reports the outcome. The promise never rejects; the failure is its
	 * value.
	 */
	const attempt = useRef<{
		key: string;
		settled: Promise<Error | null>;
	} | null>(null);

	useEffect(() => {
		if (!enabled || !analytics || orderNumber == null) return;
		const key = String(orderNumber);
		if (attempt.current?.key !== key) {
			attempt.current = {
				key,
				settled: reportPurchase(client, analytics, {
					sessionId,
					orderNumber,
					affiliation,
					storeId: client.checkout.rememberedStoreId(),
				}).then(
					() => null,
					(cause: unknown) => {
						const failure =
							cause instanceof Error ? cause : new Error(String(cause));
						console.warn("shopkit: the purchase was not tracked", failure);
						return failure;
					},
				),
			};
			// A new order in the same slot starts from a clean answer.
			setTracked(false);
			setError(null);
		}
		let active = true;
		void attempt.current.settled.then((failure) => {
			if (!active) return;
			if (failure) setError(failure);
			else setTracked(true);
		});
		return () => {
			active = false;
		};
	}, [client, analytics, sessionId, orderNumber, enabled, affiliation]);

	return { tracked, error };
}

export interface ReportPurchaseInput {
	sessionId?: string | null;
	orderNumber: string | number;
	affiliation?: string | null;
	/**
	 * The shop's numeric store id for the dedup key. Read it before a completed
	 * confirmation poll, which forgets it. Defaults to the shop prefix.
	 */
	storeId?: string | null;
}

/**
 * Build the purchase from the checkout session and hand it to the hub.
 * Resolves to what `Analytics.trackPurchase` returned (false = this browser
 * already reported the order); rejects when there is nothing to build from.
 * @internal
 */
export async function reportPurchase(
	client: ShopkitClient,
	analytics: Analytics,
	input: ReportPurchaseInput,
): Promise<boolean> {
	const sessionId =
		input.sessionId ?? (await client.checkout.currentSessionId());
	if (!sessionId) {
		throw new Error(
			"shopkit: no checkout session to build the purchase from. Pass a " +
				"sessionId, or call `analytics.trackPurchase()` yourself.",
		);
	}
	const snapshot = await client.checkout.getSession(sessionId);
	const purchase = purchaseFromSession(snapshot, input.orderNumber, {
		affiliation: input.affiliation,
	});
	if (!purchase) {
		throw new Error(
			"shopkit: the platform returned no order data for this checkout " +
				"session, so the purchase could not be built. Call " +
				"`analytics.trackPurchase()` yourself with the order's lines and total.",
		);
	}
	return analytics.trackPurchase(purchase, {
		storeId:
			input.storeId ?? client.checkout.rememberedStoreId() ?? client.shopPrefix,
		orderNumber: input.orderNumber,
	});
}
