/**
 * Analytics and marketing pixels for a headless storefront, gated on the
 * shopper's consent.
 *
 * ```ts
 * import { Analytics, ConsentStore, destinationsFromShop } from "@quickbutik/kit"
 *
 * const consent = new ConsentStore()
 * const analytics = new Analytics({ consent, storeId: cart.storeId })
 * analytics.start()
 * analytics.attachCart(cartStore)                      // add_to_cart / remove_from_cart
 *
 * const shop = await shopkit.shop.get()
 * for (const d of destinationsFromShop(shop.tracking)) analytics.addDestination(d)
 *
 * analytics.track(viewItemEvent(product, variant, "SEK"))
 * analytics.trackPurchase(purchaseFromSession(session, orderNumber)!, { orderNumber })
 * ```
 *
 * The event vocabulary is GA4's. `@quickbutik/kit/react` and
 * `@quickbutik/kit/elements` wire this up automatically.
 */

export type { AnalyticsOptions } from "./analytics.js";
export { Analytics } from "./analytics.js";
export type {
	AnalyticsContext,
	AnalyticsDestination,
} from "./destination.js";
export type { GoogleTagOptions } from "./destinations/google-tag.js";
export {
	CONSENT_UPDATE_EVENT,
	googleTagDestination,
} from "./destinations/google-tag.js";
export type { MetaPixelOptions } from "./destinations/meta-pixel.js";
export { metaPixelDestination } from "./destinations/meta-pixel.js";
export type {
	CartLineDiff,
	CommerceEvent,
	CommerceEventName,
	CommerceEventParams,
	CommerceItem,
	PurchaseEvent,
} from "./events.js";
export {
	bareProductId,
	cartLineDiff,
	itemFromCartLine,
	itemFromProduct,
	itemsFromCart,
	itemsFromCheckoutProducts,
	itemsParams,
	purchaseDedupKey,
	purchaseEventId,
	purchaseFromSession,
	purchaseToEvent,
	searchEvent,
	viewItemEvent,
	viewItemListEvent,
} from "./events.js";
export type { DestinationsFromShopOptions } from "./from-shop.js";
export { destinationsFromShop } from "./from-shop.js";
export type {
	CookieList,
	GaLink,
	HandoffParamsOptions,
} from "./handoff.js";
export { appendCheckoutHandoffParams, readGaCookies } from "./handoff.js";
export { ANALYTICS_SCRIPT_ATTR, injectScript } from "./script.js";
