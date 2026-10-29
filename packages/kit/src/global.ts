/**
 * `dist/quickbutik-kit.global.js` — the script-tag build.
 *
 * One file, no bundler, no npm, no build step:
 *
 * ```html
 * <script defer src="https://…/quickbutik-kit.global.js"
 *         data-publishable-key="qb_pk_…"
 *         data-currency="SEK"
 *         data-locale="sv-SE"></script>
 * ```
 *
 * The script configures the ambient shop from its `data-*` attributes and
 * registers the custom elements; no wrapper or init call is needed.
 *
 * - `data-storefront-id="sf_…"` prices and attributes everything on the page
 *   to a campaign storefront.
 * - `data-currency` is the starting currency (default: the shop's own).
 * - A consent banner is mounted (unless the page has its own
 *   `<qb-consent-banner>`), and the shop's GA4 / GTM / Meta pixel load once
 *   the shopper agrees. `data-consent="false"` or `data-analytics="false"`
 *   opts out.
 */

/** Replaced at bundle time with the package version. */
declare const __KIT_VERSION__: string;

import { Analytics } from "./analytics/analytics.js";
import { googleTagDestination } from "./analytics/destinations/google-tag.js";
import { metaPixelDestination } from "./analytics/destinations/meta-pixel.js";
import type { CommerceEvent, PurchaseEvent } from "./analytics/events.js";
import { appendCheckoutHandoffParams } from "./analytics/handoff.js";
import { readConsentCookie } from "./consent/cookie.js";
import { ConsentStore } from "./consent/store.js";
import { requireAmbientConsent } from "./elements/consent-context.js";
import {
	type DefinedElements,
	type DefineElementsOptions,
	defineElements,
	elementConstructors,
} from "./elements/registry.js";
import {
	type ConfigureOptions,
	configure,
	getAmbientShop,
	resetAmbientShop,
	type ShopContextValue,
	setAmbientClient,
	setCurrency,
} from "./elements/shop-context.js";
import { formatMoney, formatMoneyRange } from "./format/money.js";
import {
	applyImageTransform,
	buildImageSrcSet,
	pickProductImage,
	productImages,
	resolveCategoryImageUrl,
	resolveProductImageUrl,
} from "./media/image-url.js";
import { createShopkitClient, ShopkitClient } from "./sdk/client.js";
import { describeCurrency } from "./sdk/currency.js";
import {
	ShopkitApiError,
	ShopkitAuthError,
	ShopkitConfigError,
	ShopkitError,
	ShopkitNetworkError,
	ShopkitScopeError,
} from "./sdk/errors.js";
import {
	DEFAULT_STOREFRONT_SURFACE,
	isStorefrontId,
	isStorefrontSurface,
	STOREFRONT_SURFACES,
	storefrontRefusal,
} from "./sdk/storefront.js";
import { SUCCESS_MODES } from "./sdk/types/checkout.js";
import { buildSeo, toNextMetadata } from "./seo/index.js";
import { AsyncResource } from "./state/async-resource.js";
import { CartStore } from "./state/cart-store.js";
import { ProductController } from "./state/product-controller.js";

/** The script tag's `data-*` attributes: `ConfigureOptions`, kebab-cased. */
function readScriptConfig(script: HTMLElement | null): {
	config: ConfigureOptions | null;
	autoDefine: boolean;
	prefix: string | undefined;
} {
	const data = script?.dataset ?? {};
	const publishableKey = data.publishableKey;

	return {
		autoDefine: data.noAutoDefine === undefined,
		prefix: data.prefix,
		config: publishableKey
			? {
					publishableKey,
					apiUrl: data.apiUrl,
					checkoutUrl: data.checkoutUrl,
					imageBaseUrl: data.imageBaseUrl,
					storageKeyPrefix: data.storageKeyPrefix,
					storefrontId: data.storefrontId,
					currency: data.currency,
					locale: data.locale,
					...readConsentAttributes(data),
					...readAnalyticsAttributes(data),
				}
			: null,
	};
}

/**
 * Consent is on by default. `data-consent="false"` turns it off (no banner,
 * no analytics, nothing on the checkout URL). Otherwise
 * `data-consent-revision`, `-cookie`, `-domain`, `-max-age-days` configure
 * the page's consent store, and `data-consent-lang`,
 * `data-privacy-policy-url`, `data-consent-banner="false"` and
 * `data-consent-unstyled` the banner the kit mounts for the page.
 */
function readConsentAttributes(
	data: DOMStringMap,
): Pick<ConfigureOptions, "consent"> {
	if (data.consent === "false") return { consent: false };
	const options = {
		revision: numberAttribute(data.consentRevision),
		maxAgeDays: numberAttribute(data.consentMaxAgeDays),
		cookieName: data.consentCookie || undefined,
		domain: data.consentDomain || undefined,
		lang: data.consentLang || undefined,
		privacyPolicyUrl: data.privacyPolicyUrl || undefined,
		banner: data.consentBanner === "false" ? false : undefined,
		unstyled: data.consentUnstyled !== undefined ? true : undefined,
	};
	const given = Object.fromEntries(
		Object.entries(options).filter(([, value]) => value !== undefined),
	);
	return Object.keys(given).length > 0 ? { consent: given } : {};
}

/**
 * Analytics is on by default, gated on consent: the merchant's GA4 / GTM /
 * Meta from the shop's settings. `data-analytics="false"` turns it off;
 * `data-analytics-require-consent="false"` runs it ungated;
 * `data-analytics-load-before-consent` loads GTM / gtag.js before a decision
 * (Consent Mode denied).
 */
function readAnalyticsAttributes(
	data: DOMStringMap,
): Pick<ConfigureOptions, "analytics"> {
	if (data.analytics === "false") return { analytics: false };
	const options: Exclude<ConfigureOptions["analytics"], boolean | undefined> =
		{};
	if (data.analyticsRequireConsent === "false") options.requireConsent = false;
	if (isOn(data.analyticsLoadBeforeConsent)) options.loadBeforeConsent = true;
	return Object.keys(options).length > 0 ? { analytics: options } : {};
}

/** A boolean `data-*` attribute: present, and not `"false"`. */
function isOn(value: string | undefined): boolean {
	return value !== undefined && value !== "false";
}

function numberAttribute(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Captured at evaluation: `document.currentScript` is null once the script body has run. */
const currentScript =
	typeof document !== "undefined"
		? (document.currentScript as HTMLElement | null)
		: null;

const { config, autoDefine, prefix } = readScriptConfig(currentScript);

let bootError: Error | null = null;
if (config) {
	try {
		configure(config);
	} catch (error) {
		// Still register the elements, so the page can show the error.
		bootError = error instanceof Error ? error : new Error(String(error));
		console.error(bootError.message);
	}
}

let defined: DefinedElements | null = null;
if (autoDefine && typeof customElements !== "undefined") {
	defined = defineElements(prefix ? { prefix } : {});
}

/**
 * `window.Quickbutik`: the ambient shop, its SDK client, and the
 * framework-free helpers.
 */
const Quickbutik = {
	/** Semver of the build. Replaced at bundle time. */
	version: __KIT_VERSION__,

	// Setup
	configure,
	defineElements,
	elementConstructors,
	/** What `defineElements` registered on load, or null with `data-no-auto-define`. */
	defined,
	/** The error from a bad `data-publishable-key`, if there was one. */
	error: bootError,

	/**
	 * The client every element on the page uses; null until configured.
	 * Assign one to take over: `Quickbutik.client = createShopkitClient({…})`.
	 */
	get client(): ShopkitClient | null {
		return getAmbientShop()?.client ?? null;
	},
	set client(client: ShopkitClient | null) {
		if (client) setAmbientClient(client);
		else resetAmbientShop();
	},

	/** The shared cart store, for a badge or a drawer driven by hand. */
	get cart(): CartStore | null {
		return getAmbientShop()?.cartStore ?? null;
	},

	/**
	 * Empty the basket through the shared store, so every cart element
	 * updates. A no-op when nothing is configured or there is no cart. Markup
	 * equivalent: `data-qb-action="clear-cart"` inside a `<qb-cart>`.
	 */
	clearCart(): Promise<void> {
		return getAmbientShop()?.cartStore.clear() ?? Promise.resolve();
	},

	/**
	 * The currency the page is browsed in: the shopper's remembered choice,
	 * else `data-currency`, else null (the shop's own).
	 */
	get currency(): string | null {
		return getAmbientShop()?.client.currency ?? null;
	},

	/**
	 * Browse in another currency; every element reprices and the choice is
	 * remembered. `null` returns to the default. Markup equivalent:
	 * `<qb-currency-select>`.
	 */
	setCurrency,

	/** Be told when the page's currency changes. Returns an unsubscribe function. */
	onCurrencyChange(listener: (currency: string | null) => void): () => void {
		return getAmbientShop()?.client.onCurrencyChange(listener) ?? (() => {});
	},

	/** The whole ambient context, or null when nothing is configured yet. */
	get shop(): ShopContextValue | null {
		return getAmbientShop();
	},

	/**
	 * The page's consent store, created on first read and configured by the
	 * script tag's `data-consent-*` attributes.
	 */
	get consent(): ConsentStore {
		return requireAmbientConsent();
	},

	/** The shop's analytics hub, or null when analytics is off or nothing is configured. */
	get analytics(): Analytics | null {
		return getAmbientShop()?.analytics ?? null;
	},

	/**
	 * Send your own commerce event (e.g. a `page_view` on a soft navigation)
	 * through the shop's hub. A no-op when analytics is off.
	 */
	track(event: CommerceEvent): void {
		getAmbientShop()?.analytics?.track(event);
	},

	/**
	 * Report an order with your own data, e.g. on a custom thank-you page.
	 * Returns false when this browser already reported it.
	 */
	trackPurchase(
		purchase: PurchaseEvent,
		key: { storeId?: string | number | null; orderNumber?: string | number },
	): boolean {
		return getAmbientShop()?.analytics?.trackPurchase(purchase, key) ?? false;
	},

	// Consent and analytics, for a page wiring its own
	ConsentStore,
	Analytics,
	readConsentCookie,
	appendCheckoutHandoffParams,
	googleTagDestination,
	metaPixelDestination,

	// The SDK, for anything the elements do not cover
	createShopkitClient,
	ShopkitClient,
	ShopkitError,
	ShopkitApiError,
	ShopkitConfigError,
	ShopkitNetworkError,
	ShopkitScopeError,
	ShopkitAuthError,
	// Campaign storefronts: narrow a failed checkout to a campaign refusal
	storefrontRefusal,
	STOREFRONT_SURFACES,
	DEFAULT_STOREFRONT_SURFACE,
	isStorefrontId,
	isStorefrontSurface,
	SUCCESS_MODES,
	describeCurrency,

	// Framework-free helpers
	CartStore,
	ProductController,
	AsyncResource,
	formatMoney,
	formatMoneyRange,
	buildSeo,
	toNextMetadata,
	resolveProductImageUrl,
	resolveCategoryImageUrl,
	buildImageSrcSet,
	applyImageTransform,
	pickProductImage,
	productImages,
};

export type QuickbutikGlobal = typeof Quickbutik;
export type { ConfigureOptions, DefineElementsOptions };

declare global {
	interface Window {
		Quickbutik: QuickbutikGlobal;
	}
}

/** Assigned directly rather than via esbuild's `globalName`, which would expose `Quickbutik.default`. */
if (typeof window !== "undefined") {
	window.Quickbutik = Quickbutik;
}
