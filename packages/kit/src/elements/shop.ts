import { createShopkitClient, type ShopkitClient } from "../sdk/client.js";
import type { Cart } from "../sdk/types/cart.js";
import { CartStore } from "../state/cart-store.js";
import { QbElement } from "./base.js";
import { isConsentDisabled, requestAutoBanner } from "./consent-context.js";
import { type ContextProvider, provideContext } from "./context.js";
import {
	buildShopAnalytics,
	getAmbientShop,
	type ShopContextValue,
	shopContext,
} from "./shop-context.js";

/**
 * `<qb-shop>` — an explicit shop for one subtree. **Optional.**
 *
 * A page configured once — by the script tag's `data-publishable-key`, or by
 * `configure()` — has an ambient shop that every element finds on its own.
 * `<qb-shop>` is for the cases a single ambient shop cannot serve:
 *
 * ```html
 * <!-- two shops on one page -->
 * <qb-shop publishable-key="qb_pk_a_…"> … </qb-shop>
 * <qb-shop publishable-key="qb_pk_b_…"> … </qb-shop>
 *
 * <!-- one section against a local or preview API -->
 * <qb-shop publishable-key="qb_pk_…" api-url="https://api.example.test"> … </qb-shop>
 *
 * <!-- a campaign storefront (Säljplats): campaign prices on every product,
 *      cart and checkout inside -->
 * <qb-shop publishable-key="qb_pk_…" storefront-id="sf_…"> … </qb-shop>
 *
 * <!-- browse in euro until the shopper picks something else -->
 * <qb-shop publishable-key="qb_pk_…" currency="EUR"> … </qb-shop>
 *
 * <!-- a client you built yourself, cookies and all -->
 * <script>document.querySelector("qb-shop").client = myClient</script>
 *
 * <!-- no analytics for this subtree's shop, or no consent at all -->
 * <qb-shop publishable-key="qb_pk_…" analytics="false"> … </qb-shop>
 * <qb-shop publishable-key="qb_pk_…" consent="false"> … </qb-shop>
 * ```
 *
 * Consent and analytics are on by default, as for `configure()`: the shop's
 * GA4 / GTM / Meta ids load gated on the page's consent, and a default
 * `<qb-consent-banner>` is appended when the page has none (it receives
 * `privacy-policy-url` and `lang`). When the page's configured shop is the
 * same shop, its analytics is reused rather than loaded twice.
 *
 * Renders nothing and adds no markup.
 */
export class QbShopElement extends QbElement {
	static observedAttributes = [
		"publishable-key",
		"api-url",
		"checkout-url",
		"image-base-url",
		"currency",
		"locale",
		"storage-key-prefix",
		"storefront-id",
		"analytics",
		"consent",
	];

	private provider: ContextProvider | null = null;
	private value: ShopContextValue | null = null;
	private ownClient: ShopkitClient | null = null;
	/** Whether `value.analytics` was built here (and so is ours to destroy). */
	private ownsHub = false;
	private detachObserved: (() => void) | null = null;

	/**
	 * A client built elsewhere (server-rendered page, custom `fetch`,
	 * per-request cookie storage). Wins over every attribute.
	 */
	get client(): ShopkitClient | null {
		return this.value?.client ?? null;
	}

	set client(client: ShopkitClient | null) {
		this.ownClient = client;
		if (client) this.adopt(client);
	}

	/**
	 * A cart already fetched on the server, so the first paint shows the real
	 * basket. May be assigned before the element starts.
	 */
	set initialCart(cart: Cart | null) {
		this.pendingCart = cart;
		if (this.value && cart) {
			this.value.cartStore.hydrate(cart);
			this.pendingCart = null;
		}
	}

	private pendingCart: Cart | null = null;

	/** The shared cart store for this subtree. */
	get cartStore(): CartStore | null {
		return this.value?.cartStore ?? null;
	}

	protected start(): void {
		// Registered before the client is built, so a subtree upgrading in the
		// same tick finds this provider. Falls back to the ambient shop rather
		// than `undefined`, which `update()` would skip, stranding the subtree
		// if the key is removed later.
		this.provider = provideContext(
			this,
			shopContext,
			() => this.value ?? getAmbientShop() ?? undefined,
		);
		this.cleanups.push(() => {
			this.provider?.dispose();
			this.provider = null;
		});
		this.build();
		this.requestBanner();
	}

	protected update(): void {
		this.build();
		this.requestBanner();
	}

	protected stop(): void {
		// A detached subtree must not keep tracking; the hub is rebuilt on reconnect.
		if (this.value) this.releaseHub(this.value);
	}

	/**
	 * Off with `consent="false"`, with a client built with `consent: false`,
	 * or when the page turned consent off.
	 */
	private consentOn(): boolean {
		return (
			!isConsentDisabled() &&
			this.getAttribute("consent") !== "false" &&
			this.value?.client.consent.enabled !== false
		);
	}

	private analyticsWanted(): boolean {
		return this.consentOn() && this.getAttribute("analytics") !== "false";
	}

	private requestBanner(): void {
		if (!this.consentOn()) return;
		requestAutoBanner({
			lang: this.attr("lang"),
			privacyPolicyUrl: this.attr("privacy-policy-url"),
		});
	}

	/**
	 * The hub for this shop: the page's, when the page's configured shop is
	 * the same shop (one set of pixels per page), else one of its own.
	 */
	private attachHub(value: ShopContextValue): void {
		const page = getAmbientShop();
		const shared = page?.analytics;
		if (
			page &&
			page !== value &&
			shared &&
			page.client.shopPrefix === value.client.shopPrefix
		) {
			value.analytics = shared;
			this.ownsHub = false;
			this.detachObserved = shared.observeCart(value.cartStore);
			return;
		}
		value.analytics = buildShopAnalytics(value.client, value.cartStore, true);
		this.ownsHub = true;
	}

	private releaseHub(value: ShopContextValue): void {
		this.detachObserved?.();
		this.detachObserved = null;
		if (this.ownsHub) value.analytics?.destroy();
		this.ownsHub = false;
		value.analytics = null;
	}

	/**
	 * `currency` and `locale` never rebuild the client, which would replace the
	 * cart store; the current client is switched with `setCurrency` instead.
	 */
	attributeChangedCallback(name?: string): void {
		if (!this.isStarted) return;
		if ((name === "currency" || name === "locale") && this.value) {
			this.syncDisplay(this.value);
			return;
		}
		this.update();
	}

	/** The `currency` attribute last pushed into the client. */
	private appliedCurrency: string | undefined;

	/**
	 * Push `currency` / `locale` into the subtree. A change of `currency` is
	 * forwarded as `setCurrency()`; removing the attribute leaves the current
	 * currency alone.
	 */
	private syncDisplay(value: ShopContextValue): void {
		const currency = this.attr("currency");
		value.currency = currency ?? value.client.defaultCurrency ?? undefined;
		value.locale = this.attr("locale");
		if (currency !== this.appliedCurrency) {
			this.appliedCurrency = currency;
			if (currency && currency.trim().toUpperCase() !== value.client.currency) {
				value.client.setCurrency(currency).catch((error: unknown) => {
					this.fail(error, "<qb-shop> could not switch currency");
				});
				// No re-delivery: the switch already notifies every element that
				// shows prices, and delivering too would make a list fetch twice.
				return;
			}
		}
		this.provider?.update();
	}

	private build(): void {
		if (this.ownClient) {
			this.adopt(this.ownClient);
			return;
		}
		const publishableKey = this.attr("publishable-key");
		if (!publishableKey) {
			// Not an error: `<qb-shop currency="SEK">` may just scope display settings.
			if (this.value) this.releaseHub(this.value);
			this.value = null;
			this.setState("idle");
			this.provider?.update();
			return;
		}
		try {
			this.adopt(
				createShopkitClient({
					publishableKey,
					apiUrl: this.attr("api-url"),
					checkoutUrl: this.attr("checkout-url"),
					imageBaseUrl: this.attr("image-base-url"),
					storageKeyPrefix: this.attr("storage-key-prefix"),
					storefrontId: this.attr("storefront-id"),
					// On the client, so every handoff from this subtree honours it.
					...(this.getAttribute("consent") === "false" && {
						consent: false,
					}),
					// Only the default: a currency the shopper picked earlier wins.
					currency: this.attr("currency"),
				}),
			);
		} catch (error) {
			if (this.value) this.releaseHub(this.value);
			this.value = null;
			this.fail(error, "<qb-shop> could not build a client");
		}
	}

	private adopt(client: ShopkitClient): void {
		// Already serving this client (the common path): rebuilding would discard
		// the loaded cart. Display and analytics settings may still have changed.
		if (this.value?.client === client) {
			this.syncAnalytics(this.value);
			this.syncDisplay(this.value);
			return;
		}

		// A different client needs a new cart store and hub: the old cart may
		// belong to another shop.
		if (this.value) this.releaseHub(this.value);
		const cartStore = new CartStore(client);
		this.value = {
			client,
			cartStore,
			currency: this.attr("currency") ?? client.defaultCurrency ?? undefined,
			locale: this.attr("locale"),
			analytics: null,
		};
		// Only a later change of `currency` is forwarded to the client.
		this.appliedCurrency = this.attr("currency");
		if (this.analyticsWanted()) this.attachHub(this.value);
		if (this.pendingCart) {
			this.value.cartStore.hydrate(this.pendingCart);
			this.pendingCart = null;
		}
		this.setState("ready");
		this.provider?.update();
		this.emit("shop-ready", this.value);
	}

	/** Match the hub to the `analytics` attribute, for a toggle or a reconnect. */
	private syncAnalytics(value: ShopContextValue): void {
		const wanted = this.analyticsWanted();
		if (wanted && !value.analytics) this.attachHub(value);
		else if (!wanted && value.analytics) this.releaseHub(value);
	}
}
