/**
 * `@quickbutik/kit` — bring your own frontend.
 *
 * A storefront SDK for building a shop on any JavaScript stack (Next.js,
 * TanStack Start, Astro, a plain SPA) with Quickbutik as the commerce engine.
 * Works on a server and in a browser.
 *
 * ```ts
 * import { createShopkitClient } from "@quickbutik/kit"
 *
 * const shopkit = createShopkitClient({
 *   publishableKey: process.env.NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY!,
 * })
 *
 * const { data: products } = await shopkit.products.list({ limit: 12 })
 * const cart = await shopkit.cart.add({ productId: products[0].id })
 * const { url } = await shopkit.checkout.start({
 *   successUrl: "https://myshop.com/order",
 * })
 * // → send the shopper to `url`; they come back to /success/<orderNumber>
 * ```
 *
 * React hooks live in `@quickbutik/kit/react`, and headless web components for
 * every other stack in `@quickbutik/kit/elements` (or, for a page with no
 * bundler, one `<script src>` — see `@quickbutik/kit/global`).
 */

// Analytics and pixels, gated on consent.
export * from "./analytics/index.js";
// Cookie consent: an observable store, its cookie and Consent Mode signals.
export * from "./consent/index.js";
// Money as a display string.
export type { FormatMoneyOptions } from "./format/money.js";
export { formatMoney, formatMoneyRange } from "./format/money.js";
// Image URLs with CDN transforms.
export type {
	ImageSrcSetOptions,
	ImageTransform,
	PickProductImageOptions,
	ProductImageUrlOptions,
} from "./media/image-url.js";
export {
	applyImageTransform,
	buildImageSrcSet,
	pickProductImage,
	productImages,
	resolveCategoryImageUrl,
	resolveProductImageUrl,
} from "./media/image-url.js";
export type { CookieAttributes } from "./runtime/cookies.js";
export {
	deleteDocumentCookie,
	parseCookieHeader,
	readDocumentCookie,
	serializeCookie,
	writeDocumentCookie,
} from "./runtime/cookies.js";
export type { ShopkitRuntime } from "./runtime/detect.js";
// Runtime detection and storage.
export {
	canNavigateTopWindow,
	detectRuntime,
	hasDocumentCookies,
	hasLocalStorage,
	isBrowser,
} from "./runtime/detect.js";
export type {
	CookieAccessor,
	MaybePromise,
	StorageAdapter,
	StoragePreference,
	StorageSetOptions,
} from "./runtime/storage.js";
export {
	createCookieStorage,
	createDocumentCookieStorage,
	createLocalStorage,
	createMemoryStorage,
	createRequestCookieStorage,
	resolveStorage,
} from "./runtime/storage.js";
export * from "./sdk/index.js";
// SEO: meta tags and schema.org structured data.
export * from "./seo/index.js";
// Minor → major units.
export { toMajorUnits } from "./seo/money.js";
export type {
	AsyncSnapshot,
	AsyncStatus,
} from "./state/async-resource.js";
export { AsyncResource } from "./state/async-resource.js";
export type { CartMutationEvent } from "./state/cart-store.js";
export type { ProductLookup } from "./state/product-cache.js";
export { clearProductCache, getProductPromise } from "./state/product-cache.js";
// The framework-free variant-selection state machine.
export type {
	ProductControllerOptions,
	ProductSnapshot,
} from "./state/product-controller.js";
export { ProductController } from "./state/product-controller.js";
export { SessionStore } from "./state/session-store.js";
export { clearShopCache, getShopPromise } from "./state/shop-cache.js";
export type {
	VariantOptionGroupState,
	VariantOptionValueState,
	VariantPriceState,
	VariantSelection,
} from "./state/variant-matrix.js";
// Variant selection as pure functions, usable on the server.
export {
	buildPriceState,
	buildVariantMatrix,
	clearOptionValue,
	firstAvailableVariant,
	getOptionGroups,
	resolveVariant,
	selectionForVariant,
	selectOptionValue,
	variantMatchesSelection,
} from "./state/variant-matrix.js";
