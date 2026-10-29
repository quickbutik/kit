import type { ConsentCategory, ConsentState } from "../consent/types.js";
import type { CommerceEvent, PurchaseEvent } from "./events.js";

/** What the hub knows when it calls a destination. */
export interface AnalyticsContext {
	/**
	 * The shopper's decision, or null when the hub runs ungated
	 * (`requireConsent: false`) and every category is allowed.
	 */
	consent: ConsentState | null;
	/** The shop's numeric store id, null until known. Used for the purchase eventID. */
	storeId: string | null;
	/** The default currency for events that carry none. */
	currency?: string;
}

/**
 * Where events go. The kit ships Google (gtag.js / GTM) and the Meta Pixel;
 * anything else — TikTok, Klaviyo, a server-side collector — is one object
 * that implements this.
 *
 * ```ts
 * const tiktok: AnalyticsDestination = {
 *   id: "tiktok",
 *   requires: "marketing",           // nothing happens before marketing consent
 *   load() { … inject the pixel … },
 *   track(event) { if (event.name === "view_item") ttq.track("ViewContent", …) },
 * }
 * ```
 */
export interface AnalyticsDestination {
	/** Stable, unique per hub. Used for the `[data-qb-analytics]` tag and in warnings. */
	id: string;
	/**
	 * Which vendor account this instance reports to: two destinations with
	 * the same `key` are the same destination, so a provider given a new
	 * inline array each render keeps the existing one. The built-in
	 * destinations key on their ids only. Without a key the object itself is
	 * the identity.
	 */
	key?: string;
	/**
	 * The consent category this destination needs before it receives
	 * anything, `load()` included. `null` means always loaded; the destination
	 * then gates itself (as Google does through Consent Mode).
	 */
	requires: ConsentCategory | null;
	/**
	 * Put the vendor's script on the page. Called the first time the
	 * destination is allowed, only in a browser. Must be idempotent: a second
	 * hub on the same page calls it again.
	 */
	load?(context: AnalyticsContext): void;
	/** The decision changed. Called after `load()`, on every change, allowed or not. */
	onConsent?(state: ConsentState | null, context: AnalyticsContext): void;
	track(event: CommerceEvent, context: AnalyticsContext): void;
	/**
	 * The purchase, with its dedup id (`purchase_{storeId}_{orderNumber}`).
	 * Without this, the destination receives a `purchase` event via `track()`.
	 */
	trackPurchase?(
		purchase: PurchaseEvent,
		meta: { eventId: string },
		context: AnalyticsContext,
	): void;
}
