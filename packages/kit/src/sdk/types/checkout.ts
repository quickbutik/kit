import type { StorefrontSurface } from "../storefront.js";
import type { CountryCode, CurrencyCode, MinorUnits } from "./common.js";

// Session state primitives

export type FieldStatus = "empty" | "valid" | "invalid";

/** A shopper-supplied value plus the server's verdict on it. */
export interface FieldState<T = unknown> {
	value: T | null;
	status: FieldStatus;
	errors: string[];
	updatedAt: string | null;
}

/** A server-computed value derived from the fields (prices, shipping options). */
export interface DataState<T = unknown> {
	value: T | null;
	resolvedAt: string | null;
}

export type SessionFieldMap = Record<string, FieldState>;
export type SessionDataMap = Record<string, DataState>;

// Creating a session

export type CustomerType = "b2c" | "b2b";

/** Known shopper identity, seeded into the session so the checkout prefills. */
export interface SessionPrefillCustomer {
	email: string;
	postalCode: string;
	customerType?: CustomerType;
}

export interface SessionPrefillAddress {
	firstName?: string;
	lastName?: string;
	line1?: string;
	line2?: string;
	city?: string;
	postalCode?: string;
	country?: CountryCode;
	phone?: string;
	company?: string;
	companyNumber?: string;
}

/**
 * Everything seeded at creation. A value the field rejects lands as
 * `status: "invalid"` on that field — it never fails the create call, so a
 * stale saved address can't block a shopper from checking out.
 */
export interface SessionPrefill {
	customer?: SessionPrefillCustomer;
	shipping_address?: SessionPrefillAddress;
	billing_address?: SessionPrefillAddress;
}

/**
 * Where a checkout session may be embedded.
 *
 * The session names the single origin allowed to frame the checkout, which
 * the checkout sends as its `Content-Security-Policy: frame-ancestors`. A
 * session created without this cannot be framed at all.
 *
 * `checkout.mount()` fills both fields in from the current page. Pass them
 * yourself only when the page that creates the session is not the page that
 * will frame it.
 */
export interface SessionEmbed {
	/**
	 * Exactly one origin (`scheme://host[:port]`, no path, no query, no
	 * wildcard). `https` only, except `http` on loopback.
	 */
	origin: string;
	/**
	 * Where a redirect payment method (Klarna, Swish, iDEAL, full-page 3-D
	 * Secure) returns the shopper. Its origin must equal {@link origin}; the
	 * checkout appends `?qb_checkout_session=<id>` so the embed can resume.
	 */
	returnUrl: string;
}

/** How the hosted checkout ends: send the shopper back, or show the order itself. */
export const SUCCESS_MODES = ["redirect", "inline"] as const;

/**
 * - `"redirect"` — the default. After payment the hosted checkout sends the
 *   shopper to `<successUrl origin>/success/<orderNumber>`; your thank-you page
 *   confirms the order with `confirmation()` / `pollConfirmation()`.
 * - `"inline"` — the hosted checkout renders the order confirmation itself and
 *   never redirects. `successUrl` is optional; `parseReturnUrl()` never fires;
 *   the storefront learns of completion only by polling the confirmation.
 *   `backUrl` is what brings the shopper home — set it.
 *
 * The platform echoes the mode back as `successMode` on the session, the
 * session snapshot and the confirmation. A platform without inline support
 * rejects a session with no `successUrl` (400), so keep passing `successUrl`
 * until inline mode is verified on your shop.
 */
export type SuccessMode = (typeof SUCCESS_MODES)[number];

/**
 * Input to `checkout.createSession()`.
 *
 * `successUrl` is REQUIRED unless `successMode` is `"inline"`; a redirect
 * session without one throws a `ShopkitConfigError` before any request.
 */
export interface CreateSessionInput {
	/** The cart to check out. */
	cartId: string;
	/**
	 * Where the shopper lands after paying. Required unless
	 * `successMode: "inline"`, where the checkout never redirects.
	 *
	 * Any `https` URL is accepted; the host needs no registration. `http` is
	 * accepted only for `localhost` and loopback addresses; any other scheme is
	 * rejected with 400.
	 *
	 * Only the ORIGIN is used for the post-payment redirect: the hosted checkout
	 * sends the shopper to `<origin>/success/<orderNumber>?hash=…&t=…`, so mount
	 * a route there (see `parseReturnUrl`).
	 */
	successUrl?: string;
	/** `"redirect"` (the default when omitted) or `"inline"`. See {@link SuccessMode}. */
	successMode?: SuccessMode;
	/** Where "back to cart" goes. */
	cancelUrl?: string;
	/**
	 * Where the hosted checkout's "back to shop" / "continue shopping" links
	 * point (header logo, back arrow, empty-cart screen, order confirmation).
	 *
	 * Same URL rule as `successUrl`. Defaults to the shop's storefront URL,
	 * then the origin of `successUrl`. In `inline` success mode it is the only
	 * way home from the confirmation, so set it.
	 */
	backUrl?: string;
	/**
	 * Checkout UI language ("sv", "en", "en-US"). Validation is lenient — a code
	 * the checkout cannot translate falls back to the shop default rather than
	 * failing.
	 */
	language?: string;
	prefill?: SessionPrefill;
	/**
	 * Declare where this session may be framed. Required for an embedded
	 * checkout and ignored by the redirect one — see {@link SessionEmbed}.
	 */
	embed?: SessionEmbed;
	/**
	 * The campaign storefront this checkout is started from — `sf_…`. Binds the
	 * session to the campaign: its prices apply, it must be live, its quantity
	 * limits are enforced, and its id goes on the order. Falls back to the
	 * client's `storefront` binding; with neither, a cart already bound to a
	 * campaign keeps its binding. Without an explicit `cartId` it must match
	 * the client's binding (see `StorefrontAttribution`).
	 */
	storefrontId?: string;
	/**
	 * Where the campaign was presented to this shopper. Only sent together with
	 * a `storefrontId`; defaults to the client's surface, then `"shopkit"`.
	 */
	surface?: StorefrontSurface;
	/**
	 * Which theme the hosted checkout is painted in for this shopper.
	 *
	 * Set it when your own pages are dark, so the checkout does not flash white
	 * on the way in. A value is fixed for the session; when omitted, the
	 * checkout follows the merchant's shop theme, live.
	 */
	theme?: "light" | "dark";
	/**
	 * The currency the shopper is browsing in. Defaults to the client's
	 * currency (`client.currency`); pass `null` to send none.
	 *
	 * The shop decides what happens with it. On checkout-v2, as for product and
	 * cart reads: a `"display"` currency leaves the session in the shop's
	 * currency and is returned as {@link CheckoutSession.displayCurrency}; a
	 * `"charge"` currency prices and charges the session in it; anything else
	 * has no effect. Fixed when the session is created.
	 *
	 * On the legacy checkout, an offered currency is charged in when the
	 * merchant has set an exchange rate for it; otherwise the order stays in
	 * the shop's currency and the checkout may show an approximate total.
	 */
	currency?: string | null;
}

/**
 * The currency a checkout may show an APPROXIMATE amount in, next to the real
 * prices — set when the session was created with a `"display"` currency.
 */
export interface DisplayCurrency {
	/** Upper-case ISO 4217. */
	code: CurrencyCode;
	/** Units of `code` per 1 unit of the currency the session is charged in. */
	rate: number;
}

/** What `POST /v2/checkout/sessions` answers with. */
export interface CheckoutSession {
	sessionId: string;
	cartId: string;
	/** The session's success URL, or null in inline mode without one. */
	successUrl: string | null;
	cancelUrl: string | null;
	backUrl: string | null;
	language: string | null;
	/** `"storefront-native"` only for the built-in storefront; null for headless. */
	origin: string | null;
	/** The embed permission recorded at creation, or null when there is none. */
	embed?: SessionEmbed | null;
	/** How this checkout ends, as the platform echoes it. Missing means `"redirect"`. */
	successMode?: SuccessMode;
	/** The campaign storefront the session is bound to, or null. */
	storefrontId?: string | null;
	surface?: StorefrontSurface | null;
	/**
	 * The theme the shopper sees: the one requested, else the merchant's
	 * shop-wide choice.
	 */
	theme: "light" | "dark";
	/**
	 * The currency the checkout shows an approximate amount in, or null when
	 * none applies (no currency sent, the shop's own currency, or a
	 * `"charge"` currency — then `data.pricing.value.currency` is it).
	 */
	displayCurrency?: DisplayCurrency | null;
	fields: SessionFieldMap;
	data: SessionDataMap;
}

/**
 * What a `PATCH /v2/checkout/sessions/:id` answers with — the fields and data
 * after the change, plus what the change invalidated.
 */
export interface PatchResult {
	fields: SessionFieldMap;
	data: SessionDataMap;
	/** Fields whose value is now stale because a dependency changed. */
	invalidatedFields: string[];
	/** Data nodes that were re-resolved as a result. */
	resolvedData: string[];
	isComplete: boolean;
}

/** What `GET /v2/checkout/sessions/:id` answers with. */
export interface CheckoutSessionSnapshot {
	cartId: string | null;
	/** See {@link CheckoutSession.successUrl}. */
	successUrl: string | null;
	cancelUrl: string | null;
	backUrl: string | null;
	language: string | null;
	origin: string | null;
	/** The embed permission recorded at creation, or null when there is none. */
	embed?: SessionEmbed | null;
	/** How this checkout ends, as the platform echoes it. Missing means `"redirect"`. */
	successMode?: SuccessMode;
	/** The campaign storefront the session is bound to, or null. */
	storefrontId?: string | null;
	surface?: StorefrontSurface | null;
	/** See {@link CheckoutSession.displayCurrency}. */
	displayCurrency?: DisplayCurrency | null;
	fields: SessionFieldMap;
	data: SessionDataMap;
	/** True when every required field is valid — the checkout can take payment. */
	isComplete: boolean;
	/** Names of the fields still standing between the shopper and payment. */
	blockingFields: string[];
}

// Session data nodes worth reading from a storefront

/** A line the server added on top of the products (shipping, fee, discount). */
export interface OrderLine {
	id: string;
	/** `shipping` | `payment` | `promocode` | `free_shipping` | … */
	tag: string;
	label: string;
	/** Signed: negative on discounts. */
	amount: MinorUnits;
	taxRate?: number;
	taxAmount?: MinorUnits;
}

/** A cart line as the checkout session snapshotted it. */
export interface CheckoutCartProduct {
	productId: string;
	variantId?: string;
	name: string;
	variantName?: string | null;
	weight?: number | null;
	price: MinorUnits;
	quantity: number;
	imageUrl: string | null;
}

/**
 * The server-authoritative total: products + shipping + payment fee +
 * discounts. This is the figure the shopper is charged — never recompute it.
 */
export interface CheckoutOrderTotal {
	subtotal: MinorUnits;
	subtotalExclTax: MinorUnits;
	subtotalInclTax: MinorUnits;
	totalTax: MinorUnits;
	totalDiscount: MinorUnits;
	totalShipping: MinorUnits;
	totalPaymentFee: MinorUnits;
	total: MinorUnits;
	currency: CurrencyCode;
	lines: OrderLine[];
}

/** Product-only subtotals. `order_total` is the one that includes everything. */
export interface CheckoutPricing {
	subtotal: MinorUnits;
	subtotalExclTax: MinorUnits;
	subtotalInclTax: MinorUnits;
	totalTax: MinorUnits;
	/** The currency the session is priced AND charged in. */
	currency: CurrencyCode;
	/** The shop's own currency, when the session is charged in another one. */
	baseCurrency?: CurrencyCode;
	/** Units of `currency` per 1 unit of `baseCurrency`, when they differ. */
	exchangeRate?: number;
	/** Shop prices are ex-VAT and tax is added on top. Absent → false. */
	taxOnTop?: boolean;
}

/** The data nodes shopkit types; the map carries others too. */
export interface CheckoutDataNodes {
	cart_products: CheckoutCartProduct[];
	pricing: CheckoutPricing;
	order_total: CheckoutOrderTotal;
	shipping_cost: OrderLine[];
	payment_cost: OrderLine[];
	discount: OrderLine[];
	promocode: OrderLine[];
}

// Confirmation (the return leg)

/**
 * - `completed` — the order exists.
 * - `processing_payment` — payment authorized, order being created (6–17s).
 * - `no_attempt` — no payment attempt known for this session yet.
 * - `failed` — the payment attempt failed terminally.
 */
export type ConfirmationStatus =
	| "completed"
	| "processing_payment"
	| "no_attempt"
	| "failed";

export interface SessionConfirmation {
	status: ConfirmationStatus;
	orderNumber?: number;
	/**
	 * How the session ends, as the platform echoes it. Missing means
	 * `"redirect"`. In `"inline"` mode the checkout shows the confirmation
	 * itself, so `legacySuccessUrl` is never present and this poll is the
	 * storefront's only signal that the order exists.
	 */
	successMode?: SuccessMode;
	/**
	 * The platform's own success-page URL. A headless storefront normally
	 * ignores this and renders its own page.
	 */
	legacySuccessUrl?: string;
	/** Server hint for the next poll delay, in ms. */
	retryAfterMs?: number;
}

export interface PollConfirmationOptions {
	signal?: AbortSignal;
	/** Called after every poll, for a live "creating your order…" UI. */
	onUpdate?: (confirmation: SessionConfirmation) => void;
	/** Hard cap on polls. Default 20. */
	maxPolls?: number;
	/** Hard cap on total wall time in ms. Default 90000. */
	maxTotalMs?: number;
}

/**
 * Terminal outcome of polling. `timeout` is not a failure: order creation is
 * asynchronous and may still land — render "we're still working on it" rather
 * than "your payment failed".
 */
export type ConfirmationOutcome =
	| {
			kind: "completed";
			orderNumber: number | null;
			confirmation: SessionConfirmation;
	  }
	| { kind: "failed"; confirmation: SessionConfirmation }
	| { kind: "timeout"; lastStatus: ConfirmationStatus | null }
	| { kind: "aborted" };

// Hosted checkout handoff

/**
 * Which checkout a shop actually runs.
 *
 * - `"v2"` — the current Quickbutik checkout. The handoff is a checkout
 *   session, and the whole SDK surface applies: `getSession`, patching,
 *   `parseReturnUrl`, the lot.
 * - `"legacy"` — the older checkout. The handoff is an unpaid ORDER, not a
 *   session, and the platform creates it for you. See {@link LegacyHandoff}.
 *
 * The shop decides this (whether checkout-v2 is activated for it), so it can
 * differ between shops running the same storefront code.
 */
export type CheckoutFlavour = "v2" | "legacy";

/**
 * A `legacy` handoff, and how it differs from `v2`.
 *
 * The shopper returns the same way as from `v2`: to
 * `<successUrl origin>/success/<orderNumber>?t=…&hash=…`, with back links to
 * your `backUrl`, so one thank-you route serves both. The uuid `start()`
 * remembered is what `pollConfirmation()` (and `useOrderConfirmation()` /
 * `<qb-order-confirmation>` with no id given) confirms the order by. The
 * post-purchase-offer token (`&ppo=`) is only appended when `successUrl` is on
 * a host the shop owns.
 *
 * What differs from `v2`:
 *
 * 1. **`successMode: "inline"` does not apply.** The legacy checkout always
 *    redirects, so the platform refuses an inline handoff for a legacy shop
 *    with a 400 (`details.reason: "legacy_checkout_unsupported"`) before any
 *    order is created. Pass a real `successUrl`.
 * 2. **There is no session.** `getSession()` and patching do not apply. Poll
 *    {@link CheckoutResource.confirmation} with {@link legacyOrderUuid} instead.
 * 3. **A failed payment reads as `no_attempt`, not `failed`**, so a `timeout`
 *    or `no_attempt` outcome is not evidence the shopper gave up. Rely on the
 *    merchant's order confirmation email as the source of truth.
 * 4. **Campaign and Säljplats override prices are not carried over:** the
 *    legacy checkout re-prices every line from the catalog. A shop that sells
 *    on campaign pricing needs checkout-v2.
 *
 * The order also records the caller's IP rather than the shopper's; this
 * affects nothing about the handoff, payment or confirmation.
 */
export interface LegacyHandoff {
	checkout: "legacy";
	/**
	 * The unpaid order this handoff created (or reused, for the same cart).
	 * Also the handle to poll {@link CheckoutResource.confirmation} with.
	 * `start()` throws rather than return a handoff where this is null.
	 */
	legacyOrderUuid: string | null;
	cartId: string;
}

/** A `v2` handoff: an ordinary checkout session, plus which checkout answered. */
export interface V2Handoff extends CheckoutSession {
	checkout: "v2";
}

/** What `POST /v2/checkout/handoff` answers with, before the URL is resolved. */
export type CheckoutHandoff = (V2Handoff | LegacyHandoff) & {
	/**
	 * Where to send the shopper:
	 * - a URL — use it.
	 * - `null` — no checkout host is configured for this shop. A
	 *   misconfiguration, not a retryable error; `start()` throws rather than
	 *   guess.
	 * - absent — an older API without this field; `start()` builds the URL
	 *   locally.
	 */
	hostedUrl?: string | null;
	/**
	 * Where to frame the checkout, when the request asked to embed it —
	 * `/embed/{storeId}/{sessionId}`, on the checkout's own origin.
	 *
	 * `null` or absent means there is nothing to frame: no `embed` was
	 * supplied, the shop is on the legacy checkout (not embeddable), or no
	 * checkout host is configured. `mount()` then falls back to the redirect
	 * checkout and emits `fallback`.
	 */
	embedUrl?: string | null;
};

export interface HostedCheckoutUrlInput {
	sessionId: string;
	/**
	 * The shop's numeric id (`Cart.storeId`), not the prefix in the
	 * publishable key (`shopkit.shopPrefix`). Defaults to the id remembered
	 * from the last cart; `hostedUrl()` throws when none is known.
	 */
	storeId?: string | number;
	/**
	 * @deprecated Use {@link storeId}. Must likewise be the numeric id; a key
	 * prefix is rejected with a `ShopkitConfigError`. Read only when `storeId`
	 * is absent.
	 */
	shopId?: string | number;
	/** Preselect the checkout language, flash-free on first paint. */
	language?: string;
}

/**
 * What the hosted checkout appends when it sends the shopper back after a
 * completed order: `/success/<orderNumber>?hash=…&t=…`.
 */
export interface HostedCheckoutReturn {
	orderNumber: number;
	/** Legacy integrity hash. Informational — confirm via `confirmation()`. */
	hash: string | null;
	/** Unix seconds the redirect was issued. */
	timestamp: number | null;
}
