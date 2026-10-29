/**
 * `@quickbutik/kit/elements` — the storefront as custom elements.
 *
 * The same headless composition as `@quickbutik/kit/react`, for any page that
 * is not a React app: plain HTML, Astro, Vue, Svelte, server-rendered views.
 * No shadow DOM, and the page owns the markup.
 *
 * ```ts
 * import { configure, defineElements } from "@quickbutik/kit/elements"
 *
 * configure({ publishableKey: import.meta.env.VITE_QB_KEY, currency: "SEK" })
 * defineElements()
 * ```
 *
 * ```html
 * <qb-product slug="cotton-tee">
 *   <h1 data-qb-text="product.name"></h1>
 *   <p data-qb-text="price.display"></p>
 *   <qb-options>…</qb-options>
 *   <qb-add-to-cart><button>Lägg i varukorg</button></qb-add-to-cart>
 * </qb-product>
 * ```
 *
 * `configure()` (or the script tag's `data-publishable-key`) sets up the shop
 * every element finds; `<qb-shop>` only overrides it for one subtree.
 *
 * Without a bundler, use `@quickbutik/kit/global`: one `<script src>` that calls
 * both functions above from its own attributes.
 */

export type { ActionHandler } from "./actions.js";
export { delegateActions } from "./actions.js";
// The elements themselves, for registering a subset or subclassing one.
export { QbAddToCartElement } from "./add-to-cart.js";
// Base classes, for an element of your own that joins the same scope chain.
export { hasShop, QbElement } from "./base.js";
// The primitives, for a custom element that wants the same behaviour.
export type { Scope } from "./bindings.js";
export {
	bindRow,
	bindSubtree,
	isScopeOwner,
	markScopeOwner,
	resolvePath,
	scopeContext,
} from "./bindings.js";
export { QbBuyNowElement } from "./buy-now.js";
export {
	QbCartCountElement,
	QbCartElement,
	QbCartItemsElement,
} from "./cart.js";
export {
	QbCheckoutButtonElement,
	QbOrderConfirmationElement,
} from "./checkout.js";
export { QbCheckoutElement } from "./checkout-embed.js";
export {
	QbConsentBannerElement,
	QbConsentGateElement,
	QbConsentSettingsElement,
} from "./consent.js";
// The page-level consent store and the default banner.
export type { AutoBannerOptions } from "./consent-context.js";
export {
	cancelAutoBanner,
	configureConsent,
	disableAutoBanner,
	getAmbientConsent,
	isConsentDisabled,
	requestAutoBanner,
	requireAmbientConsent,
	resetAmbientConsent,
} from "./consent-context.js";
export type { Context, ContextCallback, ContextProvider } from "./context.js";
export {
	ContextRequestEvent,
	createContext,
	provideContext,
	requestContext,
} from "./context.js";
export { QbCurrencySelectElement } from "./currency-select.js";
// The consent-on-the-URL step every handoff element applies, for one of your own.
export { decorateHandoff } from "./handoff.js";
export { QbOptionsElement, QbOptionValuesElement } from "./options.js";
export type { ProductContextValue } from "./product.js";
export { productContext, QbProductElement } from "./product.js";
export { QbProductImageElement } from "./product-image.js";
export { QbProductListElement } from "./product-list.js";
// Registration
export type {
	DefinedElements,
	DefineElementsOptions,
} from "./registry.js";
export {
	defineElements,
	elementConstructors,
	stopActionWarnings,
} from "./registry.js";
export type { RepeatRow } from "./repeat.js";
export { Repeater } from "./repeat.js";
export { QbScopeElement } from "./scope.js";
export { QbSeoElement } from "./seo.js";
export { QbShopElement } from "./shop.js";
// The ambient shop — what makes `<qb-shop>` optional.
export type {
	ConfigureOptions,
	ElementsAnalyticsOptions,
	ElementsConsentOptions,
	ShopContextValue,
} from "./shop-context.js";
export {
	buildShopAnalytics,
	configure,
	getAmbientShop,
	resetAmbientShop,
	setAmbientClient,
	setCurrency,
	shopContext,
} from "./shop-context.js";

// View-model helpers, for building a scope of your own.
export type { MoneyView, PriceView, VariantView } from "./view-model.js";
export {
	cartItemScope,
	cartScope,
	money,
	optionGroupScope,
	optionValueScope,
	priceView,
	productScope,
	variantView,
} from "./view-model.js";
