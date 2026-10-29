import { searchEvent } from "../analytics/events.js";
import type { ProductSortField } from "../sdk/resources/products.js";
import type { Product } from "../sdk/types/catalog.js";
import type { Page } from "../sdk/types/common.js";
import { AsyncResource } from "../state/async-resource.js";
import { bindRow, type Scope } from "./bindings.js";
import { Repeater } from "./repeat.js";
import { QbScopeElement } from "./scope.js";
import type { ShopContextValue } from "./shop-context.js";
import { money } from "./view-model.js";

/**
 * `<qb-product-list>` — a catalog grid, one `<template>` clone per product.
 *
 * ```html
 * <qb-product-list limit="12" sort-by="price" sort-order="asc">
 *   <template>
 *     <a data-qb-attr="href:product.href">
 *       <qb-product-image width="400"></qb-product-image>
 *       <h3 data-qb-text="product.name"></h3>
 *       <span data-qb-text="product.priceFormatted"></span>
 *     </a>
 *   </template>
 * </qb-product-list>
 * ```
 *
 * Scope inside a row: the whole `Product`, plus `product.priceFormatted`,
 * `product.image` (the first image record) and `product.href` — the row's link,
 * built from the `href-template` attribute (`/products/:slug` by default).
 *
 * Every filter is an attribute, so a search box is `list.setAttribute("search", q)`;
 * a change aborts the previous request.
 */
export class QbProductListElement extends QbScopeElement {
	static observedAttributes = [
		"limit",
		"cursor",
		"search",
		"category-id",
		"sort-by",
		"sort-order",
		"min-price",
		"max-price",
		"href-template",
		"currency",
		"locale",
	];

	private shop: ShopContextValue | null = null;
	private readonly resource = new AsyncResource<Page<Product>>();
	private readonly repeater = new Repeater(this);
	private readonly rowScopes = new Map<string, Scope>();

	/** The products currently rendered. */
	get products(): Product[] {
		return this.resource.getSnapshot().data?.data ?? [];
	}

	protected start(): void {
		this.initScope();

		this.cleanups.push(
			this.resource.subscribe(() => {
				const { status } = this.resource.getSnapshot();
				this.setState(status === "idle" ? "loading" : status);
				this.render();
				if (status === "ready") {
					this.emit("products", { products: this.products });
					this.trackSearch();
				}
			}),
		);
		this.cleanups.push(() => this.resource.abort());

		// Prices are fetched in the client's currency, so a switch re-runs the query.
		this.withShop(
			(shop) => {
				this.shop = shop;
				this.load();
			},
			{ refetchOnCurrencyChange: true },
		);
	}

	protected update(): void {
		this.load();
	}

	protected stop(): void {
		this.repeater.clear();
		this.rowScopes.clear();
	}

	/** Re-run the query. Useful after the catalog changed under a long session. */
	reload(): void {
		this.load();
	}

	/** The last term reported as `search`, so a re-render is not a second search. */
	private trackedSearch: string | null = null;

	/**
	 * `search`, once per settled term: each keystroke aborts the previous
	 * request, so only the final term's results land.
	 */
	private trackSearch(): void {
		const term = this.attr("search")?.trim();
		const analytics = this.shop?.analytics;
		if (!term || !analytics || this.trackedSearch === term) return;
		this.trackedSearch = term;
		analytics.track(searchEvent(term));
	}

	private load(): void {
		if (!this.shop) return;
		const client = this.shop.client;
		const params = {
			limit: this.numberAttr("limit"),
			cursor: this.attr("cursor"),
			search: this.attr("search"),
			categoryId: this.attr("category-id"),
			sortBy: this.attr("sort-by") as ProductSortField | undefined,
			sortOrder: this.attr("sort-order") as "asc" | "desc" | undefined,
			minPrice: this.numberAttr("min-price"),
			maxPrice: this.numberAttr("max-price"),
		};
		// Search is a different endpoint; use it only when a filter asks for it.
		const filtered =
			params.search !== undefined ||
			params.categoryId !== undefined ||
			params.sortBy !== undefined ||
			params.minPrice !== undefined ||
			params.maxPrice !== undefined;

		this.setState("loading");
		void this.resource.run((signal) =>
			filtered
				? client.products.search({ ...params, signal })
				: client.products.list({
						limit: params.limit,
						cursor: params.cursor,
						signal,
					}),
		);
	}

	protected scopeFor(requester: Element): Scope | undefined {
		const row = this.repeater.rowFor(requester);
		if (!row) return this.ownScope();
		return this.rowScopes.get(row.key) ?? this.ownScope();
	}

	protected ownScope(): Scope {
		const snapshot = this.resource.getSnapshot();
		return {
			...this.parentScope,
			list: {
				loading: snapshot.loading,
				error: snapshot.error?.message ?? null,
				count: snapshot.data?.data.length ?? 0,
				empty: (snapshot.data?.data.length ?? 0) === 0,
				hasMore: snapshot.data?.has_more ?? false,
				nextCursor: snapshot.data?.next_cursor ?? null,
			},
		};
	}

	protected render(): void {
		const products = this.products;
		const fallback = this.attr("currency") ?? this.shop?.currency;
		const locale = this.attr("locale") ?? this.shop?.locale;
		const template = this.attr("href-template") ?? "/products/:slug";
		const parent = this.ownScope();

		this.toggleAttr("empty", products.length === 0);
		this.rowScopes.clear();

		this.repeater.render(
			products,
			(product) => product.id,
			(row, product) => {
				const scope: Scope = {
					...parent,
					product: {
						...product,
						image: product.images[0] ?? null,
						// The product's own currency first: its prices are in it.
						priceFormatted: money(
							product.price,
							product.currency ?? fallback,
							locale,
						).formatted,
						href: buildHref(template, product),
					},
				};
				this.rowScopes.set(row.key, scope);
				for (const root of row.roots) {
					root.setAttribute("data-product-id", product.id);
					// So a <qb-product-image> in the row knows its product.
					setProductOnImages(root, product);
				}
				bindRow(row.roots, scope);
			},
		);

		super.render();
	}
}

/** `/products/:slug` → `/products/cotton-tee`. `:id` works too. */
function buildHref(template: string, product: Product): string {
	return template
		.replace(":slug", encodeURIComponent(product.slug ?? ""))
		.replace(":id", encodeURIComponent(product.id));
}

/**
 * Hand the row's product to any product-image element inside it. Matched by
 * tag suffix so a custom `defineElements({ prefix })` still works.
 */
function setProductOnImages(root: Element, product: Product): void {
	const apply = (element: Element): void => {
		if (!element.tagName.endsWith("PRODUCT-IMAGE")) return;
		(element as Element & { product?: Product | null }).product = product;
	};
	apply(root);
	for (const child of root.querySelectorAll("*")) apply(child);
}
