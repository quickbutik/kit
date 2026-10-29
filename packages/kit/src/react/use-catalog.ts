"use client";

import { useEffect, useRef } from "react";
import { searchEvent } from "../analytics/events.js";
import type {
	ProductListParams,
	ProductSearchParams,
} from "../sdk/resources/products.js";
import type {
	Category,
	CategoryListParams,
	Product,
} from "../sdk/types/catalog.js";
import type { Page } from "../sdk/types/common.js";
import type { Shop } from "../sdk/types/shop.js";
import { useOptionalAnalytics } from "./analytics.js";
import { useShopkit } from "./context.js";
import { type AsyncState, useAsync } from "./use-async.js";
import { useClientCurrency } from "./use-currency.js";
import { useClientCustomerKey } from "./use-customer.js";

/**
 * One page of products.
 *
 * ```tsx
 * const { data, loading } = useProducts({ limit: 12 })
 * data?.data.map((product) => …)
 * ```
 *
 * Priced in the client's currency (or `params.currency`), and refetched when
 * `setCurrency()` changes it. Format with `product.currency`.
 */
export function useProducts(
	params: Omit<ProductListParams, "signal"> = {},
	options: { enabled?: boolean; initialData?: Page<Product> | null } = {},
): AsyncState<Page<Product>> {
	const client = useShopkit();
	const currency = useClientCurrency(client);
	const customer = useClientCustomerKey(client);
	return useAsync(
		(signal) => client.products.list({ ...params, signal }),
		[
			client,
			currency,
			customer,
			params.currency,
			params.limit,
			params.cursor,
			params.storefrontId,
		],
		options,
	);
}

/**
 * One page of a server-side filtered, sorted catalog search.
 *
 * ```tsx
 * const { data, loading } = useProductSearch({ search: q, sortBy: "price", limit: 24 })
 * ```
 *
 * Safe to pass an inline object: it refetches only when a parameter value
 * changes, and a superseded request is aborted.
 *
 * Inside an `<AnalyticsProvider>` a `search` event is reported once per term,
 * when its results land, not on every keystroke.
 */
export function useProductSearch(
	params: Omit<ProductSearchParams, "signal"> = {},
	options: { enabled?: boolean; initialData?: Page<Product> | null } = {},
): AsyncState<Page<Product>> {
	const client = useShopkit();
	const currency = useClientCurrency(client);
	const customer = useClientCustomerKey(client);
	const result = useAsync(
		(signal) => client.products.search({ ...params, signal }),
		[
			client,
			currency,
			customer,
			params.currency,
			params.search,
			params.sortBy,
			params.sortOrder,
			params.minPrice,
			params.maxPrice,
			params.categoryId,
			params.limit,
			params.cursor,
			params.storefrontId,
		],
		options,
	);

	const analytics = useOptionalAnalytics();
	const term = typeof params.search === "string" ? params.search.trim() : "";
	// Keyed on the result, not the term: `useAsync` keeps the previous page while
	// the next loads, so the term changes a render before its data does.
	const seen = useRef<Page<Product> | null>(null);
	const reported = useRef<string | null>(null);
	useEffect(() => {
		if (!analytics || result.loading || !result.data) return;
		if (seen.current === result.data) return;
		seen.current = result.data;
		if (!term || reported.current === term) return;
		reported.current = term;
		analytics.track(searchEvent(term));
	}, [analytics, result.loading, result.data, term]);

	return result;
}

/**
 * A single product. `data` is null when it does not exist or is hidden.
 *
 * Priced for the client's campaign storefront when it has one; pass
 * `storefrontId` to price it for another (or `null` for none) — see
 * `ProductReadOptions`. Priced in the client's currency (or `currency`), and
 * refetched when it changes.
 */
export function useProduct(
	productId: string | number | null | undefined,
	options: {
		initialData?: Product | null;
		storefrontId?: string | null;
		currency?: string | null;
	} = {},
): AsyncState<Product | null> {
	const client = useShopkit();
	const clientCurrency = useClientCurrency(client);
	const customer = useClientCustomerKey(client);
	const { storefrontId, currency, ...asyncOptions } = options;
	return useAsync(
		(signal) =>
			productId == null
				? Promise.resolve(null)
				: client.products.get(productId, {
						signal,
						...(storefrontId !== undefined && { storefrontId }),
						...(currency !== undefined && { currency }),
					}),
		[client, clientCurrency, customer, productId, storefrontId, currency],
		{ ...asyncOptions, enabled: productId != null },
	);
}

/** One page of categories. */
export function useCategories(
	params: Omit<CategoryListParams, "signal"> = {},
	options: { enabled?: boolean; initialData?: Page<Category> | null } = {},
): AsyncState<Page<Category>> {
	const client = useShopkit();
	// Group-visible products can change what a category holds.
	const customer = useClientCustomerKey(client);
	return useAsync(
		(signal) => client.categories.list({ ...params, signal }),
		[
			client,
			customer,
			params.limit,
			params.cursor,
			params.parentId,
			params.root,
			params.search,
		],
		options,
	);
}

/**
 * Shop name, logo, brand colour, default language, and its currencies
 * (`currency`, `currencies`). For a currency switcher, `useCurrency()` reads
 * the same data and adds the setter.
 */
export function useShop(
	options: { initialData?: Shop | null } = {},
): AsyncState<Shop> {
	const client = useShopkit();
	return useAsync((signal) => client.shop.get({ signal }), [client], options);
}
