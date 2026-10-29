import type { ShopkitClient } from "../sdk/client.js";
import type { Product } from "../sdk/types/catalog.js";

/**
 * Stable promises for product lookups, so React's `use()` can unwrap them
 * (a fresh promise on every render would suspend forever).
 *
 * Keyed by client (in a `WeakMap`, so a per-request server client is
 * collected with its entries), then by lookup, `storefrontId`, currency and
 * logged-in customer, so prices never leak across campaigns, currencies or
 * customer groups.
 */
const caches = new WeakMap<
	ShopkitClient,
	Map<string, Promise<Product | null>>
>();

export type ProductLookup = (
	| { slug: string; id?: undefined }
	| { id: string | number; slug?: undefined }
) & {
	/**
	 * Price the product for this campaign storefront rather than the client's
	 * own binding; `null` for none. See `ProductReadOptions.storefrontId`.
	 */
	storefrontId?: string | null;
	/**
	 * Price the product in this currency rather than the client's current one;
	 * `null` for the shop's own. See `ProductReadOptions.currency`.
	 */
	currency?: string | null;
};

/**
 * The cache key. For `storefrontId`, `undefined` (the client's binding),
 * `null` (none) and an id all key differently.
 */
function lookupKey(
	lookup: ProductLookup,
	currency: string | null,
	customer: string,
): string {
	const subject =
		lookup.slug !== undefined
			? `slug:${lookup.slug.trim().toLowerCase()}`
			: `id:${lookup.id}`;
	const base = `${subject}|cur:${currency ?? "-"}|cust:${customer}`;
	const campaign = lookup.storefrontId;
	if (campaign === undefined) return base;
	if (campaign === null) return `${base}|sf:none`;
	const trimmed = campaign.trim();
	// Empty reads as "not given", the same as it does on the resource.
	return trimmed === "" ? base : `${base}|sf:${trimmed.toLowerCase()}`;
}

/**
 * The currency a lookup reads in (its own, else the client's), fixed before
 * the request and sent explicitly so the key and the response always agree.
 */
function lookupCurrency(
	client: ShopkitClient,
	lookup: ProductLookup,
): string | null {
	const raw = lookup.currency !== undefined ? lookup.currency : client.currency;
	const trimmed = raw?.trim().toUpperCase();
	return trimmed ? trimmed : null;
}

/**
 * The cached promise for one product lookup. A rejected promise is evicted
 * so the next call retries.
 */
export function getProductPromise(
	client: ShopkitClient,
	lookup: ProductLookup,
): Promise<Product | null> {
	let cache = caches.get(client);
	if (!cache) {
		cache = new Map();
		caches.set(client, cache);
	}

	const currency = lookupCurrency(client, lookup);
	const key = lookupKey(lookup, currency, client.customers.cacheKey);
	const existing = cache.get(key);
	if (existing) return existing;

	const read = {
		currency,
		...(lookup.storefrontId !== undefined && {
			storefrontId: lookup.storefrontId,
		}),
	};
	const promise =
		lookup.slug !== undefined
			? client.products.getBySlug(lookup.slug, read)
			: client.products.get(lookup.id, read);

	promise.catch(() => {
		if (cache?.get(key) === promise) cache.delete(key);
	});

	cache.set(key, promise);
	return promise;
}

/**
 * Forget a client's cached lookups, one product's or all of them. Entries
 * live as long as the client, so a long-lived browser client should call this
 * after a revalidation.
 */
export function clearProductCache(
	client: ShopkitClient,
	lookup?: ProductLookup,
): void {
	if (!lookup) {
		caches.delete(client);
		return;
	}
	caches
		.get(client)
		?.delete(
			lookupKey(
				lookup,
				lookupCurrency(client, lookup),
				client.customers.cacheKey,
			),
		);
}
