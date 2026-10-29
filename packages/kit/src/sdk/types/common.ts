/**
 * The envelope some API responses arrive in. The transport unwraps it
 * wherever it appears (see `unwrapEnvelope`).
 */
export interface ApiEnvelope<T> {
	data?: T;
	message?: string;
	statusCode?: number;
	error?: string;
}

/** Cursor-paginated collection. */
export interface Page<T> {
	data: T[];
	has_more: boolean;
	next_cursor: string | null;
	/**
	 * Response metadata. A catalog page priced for a logged-in customer
	 * carries `pricing` (see `CatalogPricing`).
	 */
	meta?: {
		pricing?: {
			audience: "anonymous" | "customer" | "customer_group";
			groupId: number | null;
			vatDisplay: "incl" | "excl" | null;
		};
	};
}

/**
 * Every money value crossing this API is an integer in the currency's MINOR
 * unit (öre, cents). Never a float, never a formatted string. Aliased so the
 * intent is visible at every use site.
 */
export type MinorUnits = number;

/** ISO 4217, uppercase — "SEK", "NOK", "EUR". */
export type CurrencyCode = string;

/** ISO 3166-1 alpha-2, uppercase — "SE", "NO", "DK". */
export type CountryCode = string;

export interface ListParams {
	limit?: number;
	offset?: number;
}

export interface RequestOptions {
	/** Abort the underlying fetch (component unmount, route change). */
	signal?: AbortSignal;
}
