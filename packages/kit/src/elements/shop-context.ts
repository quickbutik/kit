import { Analytics, type AnalyticsOptions } from "../analytics/analytics.js";
import { destinationsFromShop } from "../analytics/from-shop.js";
import { ConsentStore, type ConsentStoreOptions } from "../consent/store.js";
import { createShopkitClient, type ShopkitClient } from "../sdk/client.js";
import type { ShopkitConfig } from "../sdk/config.js";
import { ShopkitConfigError } from "../sdk/errors.js";
import { CartStore } from "../state/cart-store.js";
import {
	configureConsent,
	disableAutoBanner,
	requestAutoBanner,
	requireAmbientConsent,
	setConsentDisabled,
} from "./consent-context.js";
import { type Context, createContext } from "./context.js";

/**
 * The shop every element works against: one client, one shared cart store, and
 * the display preferences the bindings need in order to render money as a
 * string.
 */
export interface ShopContextValue {
	client: ShopkitClient;
	cartStore: CartStore;
	/**
	 * Fallback ISO 4217 code for price formatting, used only when a response
	 * does not state its own. The browsing currency is `client.currency`.
	 */
	currency?: string;
	/** BCP 47 locale for number formatting. Defaults to the browser's. */
	locale?: string;
	/** The analytics hub for this shop, when enabled. Null or absent otherwise. */
	analytics?: Analytics | null;
}

export const shopContext: Context<ShopContextValue> =
	createContext<ShopContextValue>("quickbutik:shop");

/**
 * Options for `configure({ analytics })` and `<qb-shop analytics>`. Consent
 * always comes from the page's consent store, unless `requireConsent` is
 * false.
 */
export type ElementsAnalyticsOptions = Omit<AnalyticsOptions, "consent"> & {
	/**
	 * Load the destinations configured in the shop's admin (GA4, GTM, Meta
	 * Pixel), fetched once at startup. Default true; false to use only your
	 * own `destinations`.
	 */
	auto?: boolean;
	/**
	 * Load GTM / gtag.js before a decision, in Consent Mode denied. Default
	 * false: nothing from Google loads until `analytics` is granted. A GTM
	 * container loaded this way runs all of its tags.
	 */
	loadBeforeConsent?: boolean;
};

/**
 * `configure({ consent })` as an object: the page's consent store options,
 * plus what the automatically mounted banner is given.
 */
export interface ElementsConsentOptions extends ConsentStoreOptions {
	/**
	 * Mount the default `<qb-consent-banner>` at the end of `<body>`. Default
	 * true. A banner the page places itself always replaces it.
	 */
	banner?: boolean;
	/** Language of the banner's built-in copy. Defaults to `<html lang>`. */
	lang?: string;
	/** Adds a "Privacy policy" link to the banner. */
	privacyPolicyUrl?: string;
	/** Leave out the banner's built-in stylesheet. */
	unstyled?: boolean;
}

export interface ConfigureOptions extends Omit<ShopkitConfig, "consent"> {
	/** BCP 47 locale for number formatting. Defaults to the runtime's. */
	locale?: string;
	/**
	 * Cookie consent for the page. **On by default**: a consent banner is
	 * appended to `<body>` (unless the page has its own `<qb-consent-banner>`)
	 * and the decision is forwarded to the hosted checkout. An object
	 * configures the store (a policy `revision`, a cookie `domain`) and the
	 * banner (`lang`, `privacyPolicyUrl`, `banner: false`); a store you
	 * already hold is used as is. `false` turns it all off: no banner, no
	 * analytics, nothing appended to checkout URLs.
	 */
	consent?: boolean | ElementsConsentOptions | ConsentStore;
	/**
	 * Analytics for the shop. **On by default** (unless `consent: false`):
	 * the merchant's own GA4, GTM and Meta Pixel from the admin, loaded only
	 * once the shopper consents (unless `loadBeforeConsent`). An object adds
	 * destinations of your own or changes the rules; `false` turns it off.
	 */
	analytics?: boolean | ElementsAnalyticsOptions;
}

let ambient: ShopContextValue | null = null;
/** What `configure` was told about analytics, so `setAmbientClient` can rebuild. */
let rememberedAnalytics: boolean | ElementsAnalyticsOptions | undefined;

/**
 * Configure the shop the elements use, once, for the whole page.
 *
 * The script-tag build calls it from its own `data-*` attributes:
 *
 * ```html
 * <script defer src="…/quickbutik-kit.global.js"
 *         data-publishable-key="qb_pk_…" data-currency="SEK"></script>
 * ```
 *
 * With a bundler, call it once near your entry point:
 *
 * ```ts
 * import { configure, defineElements } from "@quickbutik/kit/elements"
 *
 * configure({ publishableKey: import.meta.env.VITE_QB_KEY, currency: "SEK" })
 * defineElements()
 * ```
 *
 * Calling it again replaces the client, the cart store (the remembered cart
 * id survives) and the analytics hub, so call it once at startup, not per
 * navigation. The consent store is only replaced when `consent` is given.
 */
export function configure(options: ConfigureOptions): ShopContextValue {
	const { locale, consent, analytics, ...config } = options;
	const consentOn = consent !== false;
	setConsentDisabled(!consentOn);
	// Consent first: the analytics hub built below reads the ambient store.
	let store: ConsentStore | null = null;
	let banner: ElementsConsentOptions = {};
	let cookieName: string | undefined;
	if (consent instanceof ConsentStore) {
		store = configureConsent(consent);
	} else if (typeof consent === "object") {
		const {
			banner: wantsBanner,
			lang,
			privacyPolicyUrl,
			unstyled,
			...storeOptions
		} = consent;
		banner = { banner: wantsBanner, lang, privacyPolicyUrl, unstyled };
		cookieName = storeOptions.cookieName;
		if (Object.keys(storeOptions).length > 0) {
			store = configureConsent(storeOptions);
		}
	}
	if (consentOn && banner.banner !== false) {
		requestAutoBanner(
			{
				lang: banner.lang,
				privacyPolicyUrl: banner.privacyPolicyUrl,
				unstyled: banner.unstyled,
			},
			{ scope: "page" },
		);
	} else {
		disableAutoBanner();
	}
	// Built eagerly so a malformed publishable key is reported at load.
	// `currency` is the initial browsing currency and the formatting fallback.
	const client = createShopkitClient({
		...config,
		consent: consentOn ? { revision: store?.revision, cookieName } : false,
	});
	ambient?.analytics?.destroy();
	const cartStore = new CartStore(client);
	rememberedAnalytics = analytics ?? consentOn;
	ambient = {
		client,
		cartStore,
		currency: client.defaultCurrency ?? undefined,
		locale,
		analytics: buildShopAnalytics(client, cartStore, rememberedAnalytics),
	};
	return ambient;
}

/**
 * Adopt a client you built yourself, e.g. one pointed at a local or preview
 * environment, or one sharing a server-rendered cart. Replaces the ambient
 * shop, keeping the display preferences and analytics choice.
 */
export function setAmbientClient(client: ShopkitClient): ShopContextValue {
	ambient?.analytics?.destroy();
	const cartStore = new CartStore(client);
	ambient = {
		client,
		cartStore,
		currency: ambient?.currency,
		locale: ambient?.locale,
		analytics: buildShopAnalytics(client, cartStore, rememberedAnalytics),
	};
	return ambient;
}

/**
 * Build and start the analytics hub for one shop: consent from the ambient
 * store (unless `requireConsent` is false), cart changes tracked as
 * `add_to_cart` / `remove_from_cart`, and, unless `auto` is false, the shop's
 * own GA4 / GTM / Meta destinations once fetched (earlier events are
 * delivered when they arrive). Null when `options` is falsy.
 */
export function buildShopAnalytics(
	client: ShopkitClient,
	cartStore: CartStore,
	options: boolean | ElementsAnalyticsOptions | undefined,
): Analytics | null {
	if (!options) return null;
	const { auto, loadBeforeConsent, ...rest } = options === true ? {} : options;
	const hub = new Analytics({
		...rest,
		consent: rest.requireConsent === false ? null : requireAmbientConsent(),
	});
	hub.start();
	hub.attachCart(cartStore);
	if (auto !== false) {
		client.shop.get().then(
			(shop) => {
				const destinations = destinationsFromShop(shop.tracking, {
					loadBeforeConsent,
				});
				if (destinations.length === 0) {
					warnOnce(
						"shopkit: analytics is on, but this shop has no tracking ids " +
							"configured (GA4, GTM or a Meta Pixel), so nothing is loaded. " +
							"Add them in the admin, or pass `destinations` of your own.",
					);
				}
				for (const destination of destinations) {
					hub.addDestination(destination);
				}
			},
			(error: unknown) => {
				warnOnce(
					"shopkit: analytics could not load the shop's tracking " +
						"configuration, so no destination was added.",
					error,
				);
			},
		);
	}
	return hub;
}

let warnedAboutTracking = false;

function warnOnce(message: string, detail?: unknown): void {
	if (warnedAboutTracking) return;
	warnedAboutTracking = true;
	if (detail === undefined) console.warn(message);
	else console.warn(message, detail);
}

/**
 * Browse the ambient shop in another currency — `client.setCurrency()` on the
 * client every element uses. Every `<qb-product>`, `<qb-product-list>` and
 * cart element reprices; the choice is remembered. `null` returns to the
 * configured default. Throws when nothing is configured.
 *
 * ```ts
 * await setCurrency("EUR")
 * ```
 */
export function setCurrency(currency: string | null): Promise<void> {
	return requireAmbientShop("setCurrency()").client.setCurrency(currency);
}

/** The ambient shop, or null when nothing has configured one yet. */
export function getAmbientShop(): ShopContextValue | null {
	return ambient;
}

/**
 * The ambient shop. Throws a {@link ShopkitConfigError} explaining how to
 * provide one, rather than letting the element silently render nothing.
 */
export function requireAmbientShop(elementName: string): ShopContextValue {
	if (ambient) return ambient;
	const subject = elementName.endsWith(")") ? elementName : `<${elementName}>`;
	throw new ShopkitConfigError(
		`shopkit: ${subject} has no shop to work against. Either put the ` +
			"publishable key on the script tag " +
			'(<script src="…/quickbutik-kit.global.js" data-publishable-key="qb_pk_…">), ' +
			'call configure({ publishableKey: "qb_pk_…" }) once at startup, or wrap ' +
			'this element in <qb-shop publishable-key="qb_pk_…">.',
	);
}

/** Forget the ambient shop. For tests, and for a hard teardown. */
export function resetAmbientShop(): void {
	ambient?.analytics?.destroy();
	ambient = null;
	rememberedAnalytics = undefined;
	warnedAboutTracking = false;
}
