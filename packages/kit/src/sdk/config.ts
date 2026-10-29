import {
	DEFAULT_CONSENT_COOKIE,
	DEFAULT_CONSENT_REVISION,
} from "../consent/cookie.js";
import type { CookieAttributes } from "../runtime/cookies.js";
import type { CookieAccessor, StoragePreference } from "../runtime/storage.js";
import { normalizeCurrency } from "./currency.js";
import { ShopkitConfigError } from "./errors.js";
import { parsePublishableKey } from "./key.js";
import type { ShopkitScope } from "./scopes.js";
import {
	defaultStorefrontStoragePrefix,
	resolveStorefrontBinding,
	type ShopkitStorefrontConfig,
	type StorefrontBinding,
} from "./storefront.js";

/**
 * Quickbutik's public commerce API, used when `apiUrl` is omitted. It accepts
 * publishable keys only and allows CORS from any origin. The merchant API
 * (`https://api.quickbutik.com`) is a separate host this SDK does not use.
 */
export const DEFAULT_API_URL = "https://commerce.quickbutik.com";

/**
 * Quickbutik's hosted checkout (checkout-v2). Used when `checkoutUrl` is
 * omitted, and only as a fallback: `checkout.start()` normally uses the URL
 * the platform returns for the checkout the shop runs.
 */
export const DEFAULT_CHECKOUT_URL = "https://pay.quickbutik.com";

/**
 * Cookie-consent settings, shared by the client, `<ShopkitProvider>` and the
 * checkout handoff.
 */
export interface ShopkitConsentConfig {
	/**
	 * The cookie-policy revision. Bump it when the policy changes materially
	 * and every shopper is asked again: a decision stored under an older
	 * revision reads as undecided. Defaults to 1.
	 */
	revision?: number;
	/** The cookie the decision lives in. Defaults to `qb_consent`. */
	cookieName?: string;
}

export interface ShopkitConfig {
	/**
	 * The shop's publishable key (`qb_pk_…`). Safe to ship to a browser: it is
	 * scope-limited, shop-scoped and grants no merchant data.
	 *
	 * A `qb_pat_…` personal access token is NOT interchangeable and is rejected.
	 */
	publishableKey: string;

	/**
	 * Commerce API origin. Defaults to {@link DEFAULT_API_URL}; point it at a
	 * local or preview environment for development. A trailing `/v2` is
	 * tolerated.
	 */
	apiUrl?: string;

	/**
	 * Origin of the checkout-v2 host the shopper is handed off to. Defaults to
	 * {@link DEFAULT_CHECKOUT_URL}.
	 *
	 * When set, it takes precedence over the URL the platform returns for a
	 * checkout-v2 handoff (for a preview environment, or a checkout proxied onto
	 * your own domain). It has no effect on shops running the legacy checkout.
	 */
	checkoutUrl?: string;

	/**
	 * Fallback base URL for the shop's images. Normally unnecessary: product
	 * images arrive with an absolute `url`. Set it to route images through your
	 * own CDN, or for an older platform version that sends bare filenames.
	 *
	 * Omit the `products/` segment, e.g.
	 * `https://cdn.quickbutik.com/images/<shopPrefix>` (see `shopkit.shopPrefix`).
	 */
	imageBaseUrl?: string;

	/**
	 * The scopes the key carries. Used for a local pre-flight check that turns an
	 * opaque 403 into a named error before the request leaves the process.
	 *
	 * Defaults to the standard storefront set. Pass `null` to disable the check
	 * when the key's scopes are decided elsewhere.
	 */
	scopes?: readonly ShopkitScope[] | readonly string[] | null;

	/** How to persist the cart / session ids. See {@link StoragePreference}. */
	storage?: StoragePreference;

	/**
	 * Server-side cookie access. Supplying this is what makes an RSC, a route
	 * handler or a server function see the same cart as the browser.
	 */
	cookies?: CookieAccessor;

	/** Attributes for cookies shopkit writes. */
	cookieAttributes?: CookieAttributes;

	/**
	 * Cookie consent. On by default: `<ShopkitProvider>` and the elements show
	 * a consent banner and load the shop's GA4 / GTM / Meta pixel once the
	 * shopper agrees, and `checkout.start()` on a server with cookie access
	 * forwards the decision to the hosted checkout.
	 *
	 * An object sets the policy `revision` and cookie name. `false` turns it all
	 * off. An explicit `consent` prop on `<ShopkitProvider>` wins over this.
	 */
	consent?: boolean | ShopkitConsentConfig;

	/**
	 * Sell into one campaign storefront (a Säljplats in the Quickbutik admin)
	 * with this whole client: every cart it creates is bound to and priced by
	 * the campaign, and every checkout carries the campaign's id and `surface`
	 * (default `"shopkit"`). See `StorefrontAttribution` for per-call overrides.
	 *
	 * Also changes the default {@link storageKeyPrefix} to `qb_<id lower-cased>`,
	 * so adding this to an existing integration stops it reading carts and
	 * sessions remembered under the old prefix; pass `storageKeyPrefix: "qb"`
	 * to keep them.
	 *
	 * A malformed id throws a `ShopkitConfigError`; whether the campaign is open
	 * is only known at checkout (see `storefrontRefusal()`). `null` means no
	 * binding.
	 */
	storefront?: ShopkitStorefrontConfig | null;

	/**
	 * Shorthand for `storefront: { id }`, with the surface defaulted to
	 * `"shopkit"`. Everything {@link storefront} says applies.
	 *
	 * Both may be set if they name the same campaign (case-insensitive); the
	 * surface then comes from `storefront`. Two different ids throw a
	 * `ShopkitConfigError`. `null` and `""` mean "not set".
	 */
	storefrontId?: string | null;

	/**
	 * The currency to browse in (`"EUR"`, any case) until the shopper picks one
	 * with `client.setCurrency()`; that choice is remembered (under
	 * `${storageKeyPrefix}_currency`) and wins over this default.
	 *
	 * Sent with every product read, cart request and checkout. A currency the
	 * shop does not offer falls back to the shop's own, so format amounts with
	 * `product.currency` / `cart.currency` (see `describeCurrency()` for the
	 * display/charge modes). Omitted or `null`: the shop's own currency. A value
	 * that is not a three-letter code throws a `ShopkitConfigError`.
	 */
	currency?: string | null;

	/**
	 * Prefix for stored keys. Change it to run two shops in one browser.
	 * Defaults to `"qb"`, or `qb_<storefront id lower-cased>` when a
	 * {@link storefront} is bound.
	 */
	storageKeyPrefix?: string;

	/** How long a remembered cart id lives. Defaults to 30 days. */
	cartTtlSeconds?: number;

	/** Injected fetch — for tests, or for a framework's instrumented fetch. */
	fetch?: typeof globalThis.fetch;

	/** Per-request timeout in ms. Defaults to 15000. 0 disables it. */
	timeoutMs?: number;

	/**
	 * Retries for transient failures (network error, 429, 5xx) on idempotent
	 * requests only. Defaults to 2.
	 */
	maxRetries?: number;

	/** Extra headers on every request (tracing, a custom user agent). */
	headers?: Record<string, string>;

	/**
	 * Called when a request comes back 401 — the key was rotated or revoked.
	 * Return a fresh key to adopt it and retry once; return null to let the 401
	 * surface.
	 */
	onUnauthorized?: () => Promise<string | null> | string | null;

	/**
	 * Customer sessions. `renew: false` uses a logged-in customer's access
	 * token without ever renewing it (an expired one counts as logged out).
	 * Defaults to `true`, except on storage that cannot be written
	 * (`StorageAdapter.writable: false`), where a renewal would lose the
	 * rotated refresh token.
	 */
	customerSession?: { renew?: boolean };
}

/** Config with every default applied and the key already parsed. */
export interface ResolvedShopkitConfig {
	publishableKey: string;
	/** The shop's storage prefix, decoded from the key. See `ShopkitClient.shopPrefix`. */
	shopPrefix: string;
	apiUrl: string;
	checkoutUrl: string;
	/** Whether `checkoutUrl` was set explicitly. See {@link ShopkitConfig.checkoutUrl}. */
	checkoutUrlConfigured: boolean;
	imageBaseUrl: string | null;
	/** The campaign storefront this client sells into, surface defaulted; null when none. */
	storefront: StorefrontBinding | null;
	/** The configured default currency, upper-cased; null for the shop's own. */
	currency: string | null;
	/** `null` = pre-flight checking disabled; `undefined` = use the default set. */
	scopes: readonly string[] | null | undefined;
	storage?: StoragePreference;
	cookies?: CookieAccessor;
	cookieAttributes: CookieAttributes;
	/** Consent, defaults applied. `enabled` is false only for `consent: false`. */
	consent: { enabled: boolean; revision: number; cookieName: string };
	storageKeyPrefix: string;
	cartTtlSeconds: number;
	fetch: typeof globalThis.fetch;
	timeoutMs: number;
	maxRetries: number;
	headers: Record<string, string>;
	onUnauthorized?: () => Promise<string | null> | string | null;
	customerSession: { renew?: boolean };
}

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export function resolveConfig(config: ShopkitConfig): ResolvedShopkitConfig {
	const { key, shopPrefix } = parsePublishableKey(config.publishableKey);

	const fetchImpl = config.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		throw new ShopkitConfigError(
			"shopkit: no global `fetch` in this runtime. Pass one via `fetch` " +
				"(Node 18+ has it built in; older Node needs undici).",
		);
	}

	const storefront = resolveStorefrontBinding(
		config.storefront,
		config.storefrontId,
	);

	return {
		publishableKey: key,
		shopPrefix,
		apiUrl: normalizeApiUrl(config.apiUrl ?? DEFAULT_API_URL),
		checkoutUrl: stripTrailingSlashes(
			config.checkoutUrl ?? DEFAULT_CHECKOUT_URL,
		),
		checkoutUrlConfigured:
			config.checkoutUrl !== undefined && config.checkoutUrl !== "",
		imageBaseUrl: config.imageBaseUrl
			? stripTrailingSlashes(config.imageBaseUrl)
			: null,
		storefront,
		currency: normalizeCurrency(config.currency),
		scopes: config.scopes,
		storage: config.storage,
		cookies: config.cookies,
		cookieAttributes: config.cookieAttributes ?? {},
		consent: resolveConsent(config.consent),
		storageKeyPrefix:
			config.storageKeyPrefix ??
			(storefront ? defaultStorefrontStoragePrefix(storefront) : "qb"),
		cartTtlSeconds: config.cartTtlSeconds ?? THIRTY_DAYS_SECONDS,
		// Bound so `this` isn't lost when fetch comes off globalThis.
		fetch: fetchImpl.bind(globalThis),
		timeoutMs: config.timeoutMs ?? 15_000,
		maxRetries: config.maxRetries ?? 2,
		headers: config.headers ?? {},
		onUnauthorized: config.onUnauthorized,
		customerSession: config.customerSession ?? {},
	};
}

function resolveConsent(
	consent: ShopkitConfig["consent"],
): ResolvedShopkitConfig["consent"] {
	const options =
		typeof consent === "object" && consent !== null ? consent : {};
	return {
		enabled: consent !== false,
		revision: options.revision ?? DEFAULT_CONSENT_REVISION,
		cookieName: options.cookieName || DEFAULT_CONSENT_COOKIE,
	};
}

/**
 * Strip trailing slashes and a trailing `/v2`. Request paths carry their own
 * `/v2`, so an `apiUrl` ending in `/v2` would otherwise produce `/v2/v2/...`.
 */
export function normalizeApiUrl(url: string): string {
	return stripTrailingSlashes(url).replace(/\/v2$/, "");
}

function stripTrailingSlashes(url: string): string {
	return url.replace(/\/+$/, "");
}
