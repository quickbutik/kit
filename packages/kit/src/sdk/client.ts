import { detectRuntime, type ShopkitRuntime } from "../runtime/detect.js";
import { resolveStorage, type StorageAdapter } from "../runtime/storage.js";
import { SessionStore } from "../state/session-store.js";
import {
	type ResolvedShopkitConfig,
	resolveConfig,
	type ShopkitConfig,
} from "./config.js";
import { CurrencyPreference } from "./currency.js";
import { CustomerAuth } from "./customer-auth.js";
import { CartResource } from "./resources/cart.js";
import { CategoriesResource } from "./resources/categories.js";
import { CheckoutResource } from "./resources/checkout.js";
import { ConsentResource } from "./resources/consent.js";
import { CustomersResource } from "./resources/customers.js";
import { NewsletterResource } from "./resources/newsletter.js";
import { ProductsResource } from "./resources/products.js";
import { ShopResource } from "./resources/shop.js";
import { createScopeGuard, type ScopeGuard } from "./scopes.js";
import type { StorefrontBinding } from "./storefront.js";
import { Transport } from "./transport.js";
import type { CurrencyCode } from "./types/common.js";

/** What the client resolved about its environment — handy when debugging. */
export interface ShopkitRuntimeInfo {
	/** `"browser"` or `"server"`. */
	environment: ShopkitRuntime;
	/** Which storage adapter won: `cookie`, `localStorage`, `memory`, custom. */
	storage: string;
	/** True when ids can actually be remembered across requests. */
	persistent: boolean;
}

/**
 * A configured Quickbutik storefront client.
 *
 * Cheap, and stateless apart from the remembered ids and a logged-in
 * customer's session: create one per request on the server and one per app
 * in the browser.
 */
export class ShopkitClient {
	readonly products: ProductsResource;
	readonly categories: CategoriesResource;
	readonly cart: CartResource;
	readonly checkout: CheckoutResource;
	readonly shop: ShopResource;
	/**
	 * The shopper's cookie-consent decision and the consent settings. On a
	 * server, pass `await shopkit.consent.read()` to `<ShopkitProvider>` as
	 * `consent={{ initialState }}` so the banner is right on first paint.
	 */
	readonly consent: ConsentResource;
	/**
	 * Customer accounts: `login()`, `register()`, `logout()`, password reset,
	 * `me()`, the club. A logged-in customer's token is sent with every
	 * request of this client.
	 */
	readonly customers: CustomersResource;
	/**
	 * Newsletter sign-up: `isEnabled()` (whether to show the form) and
	 * `subscribe({ email })`. Never sends the customer token.
	 */
	readonly newsletter: NewsletterResource;

	/**
	 * The shop's storage prefix (`101928Y`), decoded from the publishable key.
	 *
	 * It is the shop's CDN folder
	 * (`https://cdn.quickbutik.com/images/<shopPrefix>/products/<file>`), NOT
	 * the numeric shop id the hosted checkout needs: that is `Cart.storeId`.
	 */
	readonly shopPrefix: string;
	readonly scopes: ScopeGuard;
	readonly runtime: ShopkitRuntimeInfo;
	/**
	 * The campaign storefront this client sells into, or null. See
	 * `ShopkitConfig.storefront`.
	 */
	readonly storefront: StorefrontBinding | null;

	private readonly resolved: ResolvedShopkitConfig;
	private readonly store: SessionStore;
	private readonly currencyPreference: CurrencyPreference;

	constructor(config: ShopkitConfig) {
		this.resolved = resolveConfig(config);
		this.shopPrefix = this.resolved.shopPrefix;
		this.storefront = this.resolved.storefront;
		this.scopes = createScopeGuard(this.resolved.scopes);

		const storage = resolveStorage({
			preference: this.resolved.storage,
			cookies: this.resolved.cookies,
			cookieAttributes: this.resolved.cookieAttributes,
		});
		this.store = new SessionStore(
			storage,
			this.resolved.storageKeyPrefix,
			this.resolved.cartTtlSeconds,
		);
		this.currencyPreference = new CurrencyPreference(
			storage,
			this.resolved.storageKeyPrefix,
			this.resolved.currency,
		);
		this.runtime = {
			environment: detectRuntime(),
			storage: storage.kind,
			persistent: storage.kind !== "memory",
		};

		const transport = new Transport(this.resolved);
		const customerAuth = new CustomerAuth(this.store, transport, {
			prefix: this.resolved.storageKeyPrefix,
			renew: this.resolved.customerSession.renew ?? storage.writable !== false,
		});
		transport.attachCustomerTokens(customerAuth);
		// Bound like the cart, so catalog prices match what the cart charges.
		this.products = new ProductsResource(
			transport,
			this.scopes,
			this.storefront,
			this.currencyPreference,
		);
		this.categories = new CategoriesResource(transport, this.scopes);
		this.cart = new CartResource(
			transport,
			this.scopes,
			this.store,
			this.storefront,
			this.currencyPreference,
		);
		this.consent = new ConsentResource(this.resolved);
		this.checkout = new CheckoutResource(
			transport,
			this.scopes,
			this.store,
			this.resolved,
			this.cart,
			this.currencyPreference,
			this.consent,
		);
		this.shop = new ShopResource(transport, this.scopes);
		this.customers = new CustomersResource(
			transport,
			this.scopes,
			this.store,
			customerAuth,
		);
		this.newsletter = new NewsletterResource(transport, this.scopes);
	}

	/**
	 * The currency this client browses in: the shopper's remembered choice,
	 * else `ShopkitConfig.currency`, else null (the shop's own currency).
	 *
	 * This is what is requested, not necessarily what comes back: a currency
	 * the shop does not offer falls back to the shop's, so format prices with
	 * `product.currency` / `cart.currency` (see `describeCurrency()`).
	 *
	 * With an async-only storage adapter (Next's `cookies()`) this returns the
	 * configured default; requests still consult the adapter.
	 */
	get currency(): CurrencyCode | null {
		return this.currencyPreference.peek();
	}

	/** The `currency` this client was configured with, ignoring any choice. */
	get defaultCurrency(): CurrencyCode | null {
		return this.currencyPreference.fallback;
	}

	/**
	 * Browse in another currency: remember it, and notify
	 * {@link onCurrencyChange} subscribers so a UI can refetch.
	 *
	 * ```ts
	 * await shopkit.setCurrency("EUR")   // every read and checkout now asks for EUR
	 * await shopkit.setCurrency(null)    // back to the default
	 * ```
	 *
	 * The cart is priced per request, so it reads in the new currency next
	 * time. Throws a `ShopkitConfigError` for a value that is not a three-letter
	 * code; a code the shop does not offer resolves to the shop's currency.
	 */
	setCurrency(currency: string | null): Promise<void> {
		return this.currencyPreference.set(currency);
	}

	/**
	 * Be told when {@link currency} changes through `setCurrency()`. Returns an
	 * unsubscribe function.
	 */
	onCurrencyChange(
		listener: (currency: CurrencyCode | null) => void,
	): () => void {
		return this.currencyPreference.subscribe(listener);
	}

	/**
	 * @deprecated Use {@link shopPrefix}. This is the shop's storage prefix, not
	 * the numeric id the hosted checkout needs (`cart.storeId`).
	 */
	get shopId(): string {
		return this.shopPrefix;
	}

	/** The commerce API origin this client talks to. */
	get apiUrl(): string {
		return this.resolved.apiUrl;
	}

	/** The hosted checkout origin shoppers are handed off to. */
	get checkoutUrl(): string {
		return this.resolved.checkoutUrl;
	}

	/**
	 * Fallback image base, or null when images are rendered from the absolute
	 * `url` the API sends (the normal case). See `ShopkitConfig.imageBaseUrl`.
	 */
	get imageBaseUrl(): string | null {
		return this.resolved.imageBaseUrl;
	}

	/** The underlying storage adapter, for tests and for advanced integrations. */
	get storage(): StorageAdapter {
		return this.store.storage;
	}

	/**
	 * A copy of this client bound to different storage — the idiomatic way to
	 * reuse one long-lived configuration across many server requests, each with
	 * its own cookie jar.
	 *
	 * ```ts
	 * const base = { publishableKey, apiUrl }
	 * export function shopkitForRequest(request: Request) {
	 *   return createShopkitClient(base).withStorage(
	 *     createRequestCookieStorage(request),
	 *   )
	 * }
	 * ```
	 */
	withStorage(storage: StorageAdapter): ShopkitClient {
		return new ShopkitClient({
			...this.toConfig(),
			storage,
			// Otherwise `resolveStorage` would prefer the accessor over `storage`.
			cookies: undefined,
		});
	}

	/** The config this client was built from, for cloning. */
	private toConfig(): ShopkitConfig {
		return {
			publishableKey: this.resolved.publishableKey,
			apiUrl: this.resolved.apiUrl,
			// Only when set explicitly: a configured `checkoutUrl` takes precedence
			// over the platform's (see ShopkitConfig.checkoutUrl).
			...(this.resolved.checkoutUrlConfigured && {
				checkoutUrl: this.resolved.checkoutUrl,
			}),
			...(this.resolved.imageBaseUrl !== null && {
				imageBaseUrl: this.resolved.imageBaseUrl,
			}),
			...(this.resolved.storefront !== null && {
				storefront: this.resolved.storefront,
			}),
			currency: this.resolved.currency,
			scopes: this.resolved.scopes,
			cookies: this.resolved.cookies,
			cookieAttributes: this.resolved.cookieAttributes,
			consent: this.resolved.consent.enabled
				? {
						revision: this.resolved.consent.revision,
						cookieName: this.resolved.consent.cookieName,
					}
				: false,
			storageKeyPrefix: this.resolved.storageKeyPrefix,
			cartTtlSeconds: this.resolved.cartTtlSeconds,
			fetch: this.resolved.fetch,
			timeoutMs: this.resolved.timeoutMs,
			maxRetries: this.resolved.maxRetries,
			headers: this.resolved.headers,
			onUnauthorized: this.resolved.onUnauthorized,
			customerSession: this.resolved.customerSession,
		};
	}
}

/**
 * Create a storefront client.
 *
 * ```ts
 * const shopkit = createShopkitClient({
 *   publishableKey: process.env.NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY!,
 *   scopes: ["products:read", "cart:read", "cart:write", "checkout:read", "checkout:write"],
 * })
 * ```
 */
export function createShopkitClient(config: ShopkitConfig): ShopkitClient {
	return new ShopkitClient(config);
}
