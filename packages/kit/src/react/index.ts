"use client";

/**
 * `@quickbutik/kit/react` — hooks and components over the storefront SDK.
 *
 * Every export is a client component or hook: keep them below a `"use client"`
 * boundary and fetch catalog data on the server with the plain client from
 * `@quickbutik/kit`. State lives in a small observable store, not a
 * data-fetching library; with TanStack Query or SWR, call the client directly.
 */

// Analytics: the hub class and the types a custom destination needs.
export type { AnalyticsOptions } from "../analytics/analytics.js";
export { Analytics } from "../analytics/analytics.js";
export type {
	AnalyticsContext as AnalyticsDestinationContext,
	AnalyticsDestination,
} from "../analytics/destination.js";
export type {
	CommerceEvent,
	CommerceItem,
	PurchaseEvent,
} from "../analytics/events.js";
export type { ConsentLabels } from "../consent/labels.js";
// Consent: the store class and the shapes the hooks hand out.
export type { ConsentStoreOptions } from "../consent/store.js";
export { ConsentStore } from "../consent/store.js";
export type {
	ConsentCategory,
	ConsentChoice,
	ConsentSnapshot,
	ConsentState,
} from "../consent/types.js";
// Re-exported so a component file needs one import.
export type { CartSnapshot, CartStatus } from "../state/cart-store.js";
export { CartStore } from "../state/cart-store.js";
export type {
	AnalyticsProviderProps,
	UseTrackPurchaseInput,
	UseTrackPurchaseResult,
} from "./analytics.js";
// Analytics and pixels, gated on consent.
export {
	AnalyticsContext,
	AnalyticsProvider,
	useAnalytics,
	useOptionalAnalytics,
	useTrackPurchase,
} from "./analytics.js";
// The embedded checkout — the React face of `checkout.mount()`.
export type { CheckoutProps } from "./checkout.js";
export { Checkout } from "./checkout.js";
export type {
	ConsentBannerProps,
	ConsentBannerState,
	ConsentContextValue,
	ConsentGateProps,
	ConsentProviderProps,
	ConsentSettingsButtonProps,
	UseConsentResult,
} from "./consent.js";
// Cookie consent. `<ShopkitProvider>` mounts these by default; they are
// exported for pages that compose them themselves.
export {
	ConsentBanner,
	ConsentContext,
	ConsentGate,
	ConsentProvider,
	ConsentSettingsButton,
	useConsent,
	useOptionalConsent,
} from "./consent.js";
export type { ShopkitContextValue } from "./context.js";
export { ShopkitContext, useShopkit, useShopkitContext } from "./context.js";
// Product context and headless variant picker.
export type {
	ProductOptionGroupProps,
	ProductOptionValuesProps,
} from "./product-components.js";
export {
	AddToCart,
	ProductConsumer,
	ProductOptionGroup,
	ProductOptions,
	ProductOptionValues,
	ProductPrice,
	SelectedVariant,
} from "./product-components.js";
export type {
	ProductAddToCartState,
	ProductProviderProps,
	ProductState,
} from "./product-context.js";
export {
	ProductProvider,
	useOptionalProductState,
	useProductAddToCart,
	useProductOption,
	useProductOptions,
	useProductPrice,
	useProductState,
	useSelectedVariant,
} from "./product-context.js";
// Product images: an <img> with the CDN URL resolved.
export type {
	ProductImageOptions,
	ProductImageProps,
	ProductImageState,
} from "./product-image.js";
export { ProductImage, useProductImage } from "./product-image.js";
export type {
	ShopkitAnalyticsOptions,
	ShopkitConsentOptions,
	ShopkitProviderProps,
} from "./provider.js";
export { ShopkitProvider } from "./provider.js";
export type { JsonLdProps, SeoProps, SeoProviderProps } from "./seo.js";
// SEO. `<SEO />` renders the meta/link/title tags plus schema.org structured
// data; `useSeo` returns the same payload for a framework's own head mechanism.
export { JsonLd, SEO, SeoProvider, useSeo, useSeoDefaults } from "./seo.js";
export type { AsyncState } from "./use-async.js";
export { useAsync } from "./use-async.js";
export type { UseCartResult } from "./use-cart.js";
export { useCart } from "./use-cart.js";
export {
	useCategories,
	useProduct,
	useProductSearch,
	useProducts,
	useShop,
} from "./use-catalog.js";
export type {
	UseCheckoutResult,
	UseOrderConfirmationOptions,
	UseOrderConfirmationResult,
} from "./use-checkout.js";
export { useCheckout, useOrderConfirmation } from "./use-checkout.js";
export type { UseCurrencyResult } from "./use-currency.js";
export { useClientCurrency, useCurrency } from "./use-currency.js";
export type { UseCustomerResult } from "./use-customer.js";
export {
	useClientCustomerKey,
	useCustomer,
	useCustomerClub,
} from "./use-customer.js";
