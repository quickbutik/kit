/**
 * `@quickbutik/kit/sdk` — the framework-agnostic API surface.
 *
 * Import from here when you want the client and nothing else (a Node script, an
 * Astro endpoint, a Worker). The root entry point re-exports all of this plus
 * the runtime/storage helpers; `@quickbutik/kit/react` adds the hooks.
 */

export type { ShopkitRuntimeInfo } from "./client.js";
export { createShopkitClient, ShopkitClient } from "./client.js";
export type {
	ResolvedShopkitConfig,
	ShopkitConfig,
	ShopkitConsentConfig,
} from "./config.js";
export {
	DEFAULT_API_URL,
	DEFAULT_CHECKOUT_URL,
	normalizeApiUrl,
	resolveConfig,
} from "./config.js";
export type { CurrencyInfo } from "./currency.js";
export { describeCurrency, normalizeCurrency } from "./currency.js";
export { CUSTOMER_EVENT } from "./customer-auth.js";
// The embedded checkout: the handle `checkout.mount()` returns, plus the
// message contract itself for a host built by hand.
export type {
	EmbeddedCheckoutErrorCode,
	EmbeddedCheckoutEventMap,
	EmbeddedCheckoutEventType,
	EmbeddedCheckoutFallbackReason,
	EmbeddedCheckoutHandler,
	EmbeddedCheckoutInit,
	EmbeddedCheckoutInitEmbed,
	EmbeddedCheckoutInitFallback,
	EmbedRenderOptions,
} from "./embed/bridge.js";
export { EmbeddedCheckout } from "./embed/bridge.js";
export type {
	EmbedErrorCode,
	EmbedFrameMessage,
	EmbedHostMessage,
	EmbedNavigateReason,
	EmbedRedirectMethod,
	EmbedStep,
	EmbedViewport,
} from "./embed/messages.js";
export {
	EMBED_MESSAGE_SOURCE,
	EMBED_MESSAGE_VERSION,
	isSafeNavigationUrl,
	parseEmbedFrameMessage,
} from "./embed/messages.js";
export type { ReturnedCheckout } from "./embed/return-leg.js";
export {
	CHECKOUT_SESSION_PARAM,
	CHECKOUT_SHOP_PARAM,
	consumeReturnedSessionId,
	readReturnedCheckout,
	readReturnedSessionId,
	stripReturnedSessionId,
} from "./embed/return-leg.js";
export type { CustomerAuthErrorCode } from "./errors.js";
export {
	CUSTOMER_AUTH_ERROR_CODES,
	ShopkitApiError,
	ShopkitAuthError,
	ShopkitConfigError,
	ShopkitError,
	ShopkitNetworkError,
	ShopkitScopeError,
} from "./errors.js";
export type { ParsedPublishableKey } from "./key.js";
export {
	PUBLISHABLE_KEY_PREFIX,
	parsePublishableKey,
	redactKey,
} from "./key.js";
// Resources — exported so a consumer can type a function that takes one.
export type { CartCreateOptions } from "./resources/cart.js";
export { CartResource } from "./resources/cart.js";
export { CategoriesResource } from "./resources/categories.js";
export type {
	BuyNowResult,
	MountCheckoutInput,
	ResumeCheckoutInput,
	StartCheckoutInput,
	StartCheckoutResult,
} from "./resources/checkout.js";
export { CheckoutResource } from "./resources/checkout.js";
export { ConsentResource } from "./resources/consent.js";
export { CustomersResource } from "./resources/customers.js";
export { NewsletterResource } from "./resources/newsletter.js";
export type {
	ProductListParams,
	ProductReadOptions,
	ProductSearchParams,
	ProductSortField,
} from "./resources/products.js";
export { ProductsResource } from "./resources/products.js";
export { ShopResource } from "./resources/shop.js";
export type { ScopeGuard, ShopkitScope } from "./scopes.js";
export {
	createScopeGuard,
	DEFAULT_SHOPKIT_SCOPES,
	SHOPKIT_SCOPES,
} from "./scopes.js";
// Campaign storefronts: the binding vocabulary and the typed refusals a
// campaign checkout can answer with.
export type {
	ShopkitStorefrontConfig,
	StorefrontAttribution,
	StorefrontBinding,
	StorefrontRefusal,
	StorefrontSurface,
} from "./storefront.js";
export {
	DEFAULT_STOREFRONT_SURFACE,
	isStorefrontId,
	isStorefrontSurface,
	STOREFRONT_ID_PATTERN,
	STOREFRONT_SURFACES,
	storefrontRefusal,
} from "./storefront.js";
export type { CustomerTokenSource, TransportRequest } from "./transport.js";
export {
	CUSTOMER_TOKEN_HEADER,
	Transport,
	unwrapEnvelope,
} from "./transport.js";
export type {
	AddCartItemInput,
	Cart,
	CartItem,
	CartItemProperty,
	CartItemPropertyInput,
	CartPresentment,
} from "./types/cart.js";
export type {
	CatalogPricing,
	Category,
	CategoryAncestor,
	CategoryListParams,
	PriceSource,
	Product,
	ProductCurrency,
	ProductField,
	ProductFieldType,
	ProductImage,
	ProductOptionType,
	ProductOptionValue,
	ProductSection,
	ProductVariant,
	ProductVariantPrice,
	ProductVariantStock,
	RelatedProductSummary,
	RelatedProducts,
	RelatedProductsMode,
} from "./types/catalog.js";
export type {
	CheckoutCartProduct,
	CheckoutDataNodes,
	CheckoutFlavour,
	CheckoutHandoff,
	CheckoutOrderTotal,
	CheckoutPricing,
	CheckoutSession,
	CheckoutSessionSnapshot,
	ConfirmationOutcome,
	ConfirmationStatus,
	CreateSessionInput,
	CustomerType,
	DataState,
	DisplayCurrency,
	FieldState,
	FieldStatus,
	HostedCheckoutReturn,
	HostedCheckoutUrlInput,
	LegacyHandoff,
	OrderLine,
	PatchResult,
	PollConfirmationOptions,
	SessionConfirmation,
	SessionDataMap,
	SessionEmbed,
	SessionFieldMap,
	SessionPrefill,
	SessionPrefillAddress,
	SessionPrefillCustomer,
	SuccessMode,
	V2Handoff,
} from "./types/checkout.js";
export { SUCCESS_MODES } from "./types/checkout.js";
// Types
export type {
	ApiEnvelope,
	CountryCode,
	CurrencyCode,
	ListParams,
	MinorUnits,
	Page,
	RequestOptions,
} from "./types/common.js";
export type {
	Customer,
	CustomerAccountsConfig,
	CustomerAddress,
	CustomerClub,
	CustomerClubJoinMethod,
	CustomerGroup,
	CustomerLoginInput,
	CustomerPasswordResetInput,
	CustomerPasswordResetRequestInput,
	CustomerRegisterInput,
	CustomerRegisterResult,
	CustomerSession,
	CustomerSessionInput,
	CustomerState,
} from "./types/customer.js";
export type { NewsletterSubscribeInput } from "./types/newsletter.js";
export type {
	Shop,
	ShopBrand,
	ShopBrandColor,
	ShopCurrency,
	ShopCurrencyMode,
} from "./types/shop.js";
