import type { ScopeGuard } from "../scopes.js";
import type { Transport } from "../transport.js";
import type { Category, CategoryListParams } from "../types/catalog.js";
import type { Page, RequestOptions } from "../types/common.js";
import { normalizeCategoryId } from "./products.js";

/** The shop's category tree. Read-only for a storefront credential. */
export class CategoriesResource {
	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
	) {}

	/**
	 * One page of categories. Pass `root: true` for the top level, or a
	 * `parentId` (prefixed `cat_…`) to walk one level down.
	 */
	async list(
		params: CategoryListParams & RequestOptions = {},
	): Promise<Page<Category>> {
		// Categories live behind the products scope — they are catalog structure,
		// not a surface of their own.
		this.scopes.assert("products:read", "categories.list()");
		return this.transport.request<Page<Category>>({
			method: "GET",
			path: "/categories",
			query: {
				limit: params.limit,
				cursor: params.cursor,
				parentId: params.parentId,
				root: params.root,
				search: params.search,
			},
			signal: params.signal,
			errorMessage: "shopkit: could not list categories",
		});
	}

	/**
	 * A single category by prefixed (`cat_12`) or numeric id, or null. A bare
	 * number is prefixed, since the API rejects a plain `12` with a 400.
	 */
	async get(
		categoryId: string | number,
		options: RequestOptions = {},
	): Promise<Category | null> {
		this.scopes.assert("products:read", "categories.get()");
		return this.transport.requestOrNull<Category>({
			method: "GET",
			path: `/categories/${encodeURIComponent(normalizeCategoryId(categoryId))}`,
			signal: options.signal,
			errorMessage: "shopkit: could not load category",
		});
	}
}
