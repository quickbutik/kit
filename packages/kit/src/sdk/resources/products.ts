import { type CurrencyPreference, normalizeCurrency } from "../currency.js";
import type { ScopeGuard } from "../scopes.js";
import {
	resolveStorefrontReadId,
	type StorefrontBinding,
} from "../storefront.js";
import type { Transport } from "../transport.js";
import type { Product } from "../types/catalog.js";
import type { MinorUnits, Page, RequestOptions } from "../types/common.js";

/**
 * Which campaign storefront prices a product read.
 *
 * A client bound to a campaign (`ShopkitConfig.storefront` /
 * `storefrontId`) sends its id on every product read, so the catalog shows
 * the same campaign prices its cart will charge. Pass one here to price a
 * single read for any other campaign; `null` opts a bound client out for this
 * call and reads the shop's ordinary prices.
 */
export interface ProductReadOptions {
	/**
	 * The campaign storefront (`sf_…`) to price this read for. Defaults to the
	 * client's binding; `null` means none. A malformed id throws a
	 * `ShopkitConfigError` before the request goes out.
	 */
	storefrontId?: string | null;
	/**
	 * The currency to price this read in. Defaults to the client's
	 * (`client.currency`); `null` reads the shop's own prices. The response's
	 * `product.currency` says what the prices actually came back in.
	 */
	currency?: string | null;
}

export interface ProductListParams extends RequestOptions, ProductReadOptions {
	/** Page size, 1–200. Defaults to 50. */
	limit?: number;
	/** Opaque cursor from a previous page's `next_cursor`. */
	cursor?: string;
}

/** Sort fields the storefront search accepts. `createdAt` is catalog order. */
export type ProductSortField = "name" | "price" | "createdAt";

export interface ProductSearchParams
	extends RequestOptions,
		ProductReadOptions {
	/**
	 * Free-text term, matched against product name, SKU and GTIN, and against
	 * variant SKU/GTIN and variant option values.
	 *
	 * Whitespace-separated words are AND-ed and order-independent, so "merino
	 * crew" matches a "Crew neck, merino" product. Only the first 10 words are
	 * considered.
	 */
	search?: string;
	/** Defaults to `createdAt` server-side. */
	sortBy?: ProductSortField;
	/** Defaults to `desc` server-side. */
	sortOrder?: "asc" | "desc";
	/**
	 * Inclusive price bounds in **minor units** — `20000` is 200,00 kr.
	 *
	 * **Always in the shop's own currency**, whatever currency the read is
	 * priced in: filtering and `sortBy: "price"` run on the stored prices.
	 *
	 * **These match the undiscounted list price.** Storefront discounts are
	 * applied per page after the query runs, so on a shop running a discount a
	 * product can come back priced outside the bounds you asked for. The same
	 * caveat applies to `sortBy: "price"`.
	 *
	 * An **inverted range** (`minPrice` above `maxPrice`) is rejected with a 400
	 * rather than silently returning nothing.
	 */
	minPrice?: MinorUnits;
	maxPrice?: MinorUnits;
	/**
	 * Restrict to one category — `"cat_12"` or `12`, both accepted.
	 *
	 * Direct membership only — child categories are not walked, so filtering by
	 * a parent returns nothing that lives solely in its children. Read the ids
	 * from {@link CategoriesResource.list}.
	 */
	categoryId?: string | number;
	/** Page size, 1–200. Defaults to 50. */
	limit?: number;
	/** Opaque cursor from a previous page's `next_cursor`. */
	cursor?: string;
}

/** Matches the API's own default. */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Accept either form of a resource id, and send the prefixed one the API
 * requires (`^cat_\d+$`, `^prod_\d+$`); a bare `12` is rejected with a 400,
 * in path and query params alike. Anything not all digits passes through
 * untouched, so a malformed id still gets the server's error message.
 */
function normalizePrefixedId(
	prefix: "cat" | "prod",
	id: string | number,
): string {
	if (typeof id === "number") return `${prefix}_${id}`;
	const trimmed = id.trim();
	return /^\d+$/.test(trimmed) ? `${prefix}_${trimmed}` : trimmed;
}

/** `12` / `"12"` / `"cat_12"` → `"cat_12"`. See {@link normalizePrefixedId}. */
export function normalizeCategoryId(categoryId: string | number): string {
	return normalizePrefixedId("cat", categoryId);
}

/** `27` / `"27"` / `"prod_27"` → `"prod_27"`. See {@link normalizePrefixedId}. */
export function normalizeProductId(productId: string | number): string {
	return normalizePrefixedId("prod", productId);
}

/** Slugs compare case-insensitively and without surrounding slashes. */
function normalizeSlug(slug: string): string {
	return slug
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.toLowerCase();
}

/**
 * The shop's public catalog.
 *
 * Only visible products are served, without merchant-only data (cost prices,
 * suppliers, internal notes). There is no write surface: a publishable key
 * cannot create or edit products.
 */
export class ProductsResource {
	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
		private readonly storefront: StorefrontBinding | null = null,
		private readonly currency: CurrencyPreference | null = null,
	) {}

	/**
	 * The `currency` query param for a read: the call's own, else the
	 * client's, else `undefined` (which the transport drops).
	 */
	private async currencyQuery(
		options: ProductReadOptions,
	): Promise<string | undefined> {
		if (options.currency !== undefined) {
			return normalizeCurrency(options.currency) ?? undefined;
		}
		return (await this.currency?.resolve()) ?? undefined;
	}

	/**
	 * The `storefrontId` query param for a read, or `undefined` (which the
	 * transport drops) when no campaign applies.
	 */
	private storefrontQuery(options: ProductReadOptions): string | undefined {
		return (
			resolveStorefrontReadId(options.storefrontId, this.storefront) ??
			undefined
		);
	}

	/** One page of products, newest configured order first. */
	async list(params: ProductListParams = {}): Promise<Page<Product>> {
		this.scopes.assert("products:read", "products.list()");
		const page = await this.transport.request<Page<Product>>({
			method: "GET",
			path: "/products",
			query: {
				limit: params.limit,
				cursor: params.cursor,
				storefrontId: this.storefrontQuery(params),
				currency: await this.currencyQuery(params),
			},
			signal: params.signal,
			errorMessage: "shopkit: could not list products",
		});
		return withPricingMeta(page);
	}

	/**
	 * A single product by its prefixed (`prod_123`) or numeric id.
	 * Returns null when it does not exist or is not visible.
	 */
	async get(
		productId: string | number,
		options: RequestOptions & ProductReadOptions = {},
	): Promise<Product | null> {
		this.scopes.assert("products:read", "products.get()");
		return this.transport.requestOrNull<Product>({
			method: "GET",
			path: `/products/${encodeURIComponent(normalizeProductId(productId))}`,
			query: {
				storefrontId: this.storefrontQuery(options),
				currency: await this.currencyQuery(options),
			},
			signal: options.signal,
			errorMessage: "shopkit: could not load product",
		});
	}

	/**
	 * Filter, sort and page the catalog **server-side**.
	 *
	 * Use this for a real listing; `list()` offers only `limit`/`cursor`.
	 *
	 * ```ts
	 * const page = await shopkit.products.search({
	 *   search: "merino",
	 *   sortBy: "price",
	 *   sortOrder: "asc",
	 *   minPrice: 20000,      // minor units — 200,00 kr
	 *   categoryId: "cat_12",
	 *   limit: 24,
	 * })
	 * page.data          // Product[]
	 * page.next_cursor   // feed back as `cursor`
	 * ```
	 *
	 * There are no facet counts (derive facet values from `categories.list()`,
	 * or keep your own index) and no option-value filter (option values are
	 * per product, so "Svart" is a different id on every product).
	 *
	 * Only visible products are returned, and — unlike `list()` — visibility is
	 * applied in the query rather than after paging, so pages come back full.
	 */
	async search(params: ProductSearchParams = {}): Promise<Page<Product>> {
		this.scopes.assert("products:read", "products.search()");
		const page = await this.transport.request<Page<Product>>({
			method: "GET",
			path: "/products/search",
			query: {
				search: params.search,
				sortBy: params.sortBy,
				sortOrder: params.sortOrder,
				minPrice: params.minPrice,
				maxPrice: params.maxPrice,
				categoryId:
					params.categoryId === undefined
						? undefined
						: normalizeCategoryId(params.categoryId),
				limit: params.limit,
				cursor: params.cursor,
				storefrontId: this.storefrontQuery(params),
				currency: await this.currencyQuery(params),
			},
			signal: params.signal,
			errorMessage: "shopkit: could not search products",
		});
		return withPricingMeta(page);
	}

	/**
	 * Find a product by its URL slug.
	 *
	 * **This walks pages until it matches**, since there is no server-side slug
	 * filter, so the cost grows with the catalog. Fine for a small shop or
	 * build-time generation; on a hot path for a large shop, either:
	 *
	 * - cache the result per slug (in Next.js, wrap the call in `cache()` and set
	 *   a revalidate window), or
	 * - build a slug → id map once at deploy time from {@link listAll} and look
	 *   the id up with {@link get}, which is a single request.
	 *
	 * Matching is case-insensitive and ignores surrounding slashes, so a slug
	 * taken straight from a route param works. Returns null when nothing matches.
	 *
	 * Every page it walks is priced for the same campaign — the client's, or
	 * `storefrontId` — so the product it returns carries that campaign's prices.
	 */
	async getBySlug(
		slug: string,
		params: { pageSize?: number; maxPages?: number } & RequestOptions &
			ProductReadOptions = {},
	): Promise<Product | null> {
		const wanted = normalizeSlug(slug);
		if (!wanted) return null;

		// Resolved once, so every page of the walk is priced in one currency
		// even if the shopper switches halfway through.
		const currency = (await this.currencyQuery(params)) ?? null;
		let cursor: string | undefined;
		const maxPages = params.maxPages ?? 200;
		for (let page = 0; page < maxPages; page++) {
			const result = await this.list({
				limit: params.pageSize ?? DEFAULT_PAGE_SIZE,
				cursor,
				signal: params.signal,
				storefrontId: params.storefrontId,
				currency,
			});
			const match = result.data.find(
				(product) => normalizeSlug(product.slug ?? "") === wanted,
			);
			if (match) {
				// The page states its pricing once; a single read states it on the
				// product, which is the shape a caller of this method expects.
				const pricing = result.meta?.pricing;
				return pricing && !match.pricing ? { ...match, pricing } : match;
			}
			if (!result.has_more || !result.next_cursor) break;
			cursor = result.next_cursor;
		}
		return null;
	}

	/**
	 * Walk every page. Convenience for build-time generation (static params,
	 * sitemaps) — not something to call while rendering a request.
	 */
	async listAll(
		params: { pageSize?: number } & RequestOptions & ProductReadOptions = {},
	): Promise<Product[]> {
		const all: Product[] = [];
		const currency = (await this.currencyQuery(params)) ?? null;
		let cursor: string | undefined;
		// Bounded so a server that always reports has_more cannot spin forever.
		for (let page = 0; page < 200; page++) {
			const result = await this.list({
				limit: params.pageSize ?? DEFAULT_PAGE_SIZE,
				cursor,
				signal: params.signal,
				storefrontId: params.storefrontId,
				currency,
			});
			all.push(...result.data);
			if (!result.has_more || !result.next_cursor) break;
			cursor = result.next_cursor;
		}
		return all;
	}
}

/**
 * The API returns a list's pricing as a top-level `pricing` beside `data`;
 * the kit's contract is `page.meta.pricing`. Copied over (the original
 * stays); an existing `meta.pricing` wins.
 */
function withPricingMeta(page: Page<Product>): Page<Product> {
	const pricing = (page as { pricing?: unknown } | null)?.pricing;
	if (!page || !pricing || typeof pricing !== "object" || page.meta?.pricing) {
		return page;
	}
	return {
		...page,
		meta: {
			...page.meta,
			pricing: pricing as NonNullable<Page<Product>["meta"]>["pricing"],
		},
	};
}
