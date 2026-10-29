import type { CurrencyCode } from "./common.js";

/**
 * Shop-level presentation data a storefront needs before it can render
 * anything: the name, the logo, the default language, the terms link.
 *
 * Served by the checkout's shop endpoint, the only shop surface a
 * publishable key can reach.
 */
export interface Shop {
	name: string;
	/**
	 * The shop's own (base) currency, upper-case ISO 4217 — what every price is
	 * in when no other currency is chosen.
	 */
	currency?: CurrencyCode | null;
	/**
	 * Every currency a shopper may browse in, the base currency first. Only the
	 * base entry when the shop's currency converter is off; when absent, read
	 * it as the base currency only.
	 */
	currencies?: ShopCurrency[];
	/** The platform-issued storefront URL. */
	storeUrl?: string | null;
	/** Terms & conditions page, for the checkout consent copy. */
	termsUrl?: string | null;
	/** Default language as a raw code ("sv"). */
	language?: string | null;
	/** Whether the merchant runs a newsletter (gates the opt-in checkbox). */
	newsletterEnabled?: boolean;
	/** Whether shoppers may leave a message on the order. */
	messageEnabled?: boolean;
	brand: ShopBrand;
	/**
	 * The merchant's tracking configuration, as the hosted checkout reads it.
	 * What `destinationsFromShop()` turns into GA4 / GTM / Meta destinations.
	 */
	tracking?: ShopTracking | null;
}

/**
 * The tracking ids a merchant has configured in the admin, already validated
 * by the platform (`G-…`, `GTM-…`, a numeric pixel id) — null when unset or
 * malformed. Access tokens never leave the server: `metaCapiEnabled` only
 * says whether the platform can send Conversions API events for this shop.
 */
export interface ShopTracking {
	ga4MeasurementId: string | null;
	gtmContainerId: string | null;
	metaPixelId: string | null;
	metaCapiEnabled: boolean;
}

export interface ShopBrand {
	logo: string | null;
	favicon?: string | null;
	/**
	 * The merchant's short description of the shop. Serves as the homepage meta
	 * description when the page supplies none of its own.
	 */
	description?: string | null;
	color: ShopBrandColor;
}

export interface ShopBrandColor {
	/** Hex, e.g. `#1a73e8`. Null when the merchant never set one. */
	primary: string | null;
}

/**
 * How a currency is offered:
 *
 * - `"base"` — the shop's own currency.
 * - `"display"` — prices are SHOWN converted; the checkout charges the shop's
 *   currency.
 * - `"charge"` — priced AND charged in this currency.
 */
export type ShopCurrencyMode = "base" | "display" | "charge";

/** One currency a shop offers. */
export interface ShopCurrency {
	/** Upper-case ISO 4217. */
	code: CurrencyCode;
	mode: ShopCurrencyMode;
	/** Units of this currency per 1 unit of the shop's base currency. */
	rate: number;
}
