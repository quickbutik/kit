import { describe, expect, expectTypeOf, it } from "vitest";
import { createShopkitClient } from "../src/sdk/client.js";
import type { Category, CategoryAncestor } from "../src/sdk/types/catalog.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

function client(fetchImpl: typeof globalThis.fetch) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: "memory",
		maxRetries: 0,
	});
}

/**
 * `GET /v2/categories/cat_14` for a third-level category, as the API serves it:
 * the envelope already unwrapped, ancestor ids prefixed, ancestors ordered root
 * to immediate parent, and a legacy ancestor with no name.
 */
const SHIRTS = {
	id: "cat_14",
	name: "Skjortor",
	slug: "skjortor",
	parentId: "cat_7",
	description: null,
	description1: null,
	description2: null,
	image: null,
	imageUrl: null,
	seoTitle: null,
	ancestors: [
		{ id: "cat_2", name: "Kläder", slug: "klader" },
		{ id: "cat_7", name: null, slug: "herr" },
	],
	path: "klader/herr/skjortor",
	childCount: 0,
};

const CLOTHING = {
	...SHIRTS,
	id: "cat_2",
	name: "Kläder",
	slug: "klader",
	parentId: null,
	ancestors: [],
	path: "klader",
	childCount: 1,
};

describe("Category.ancestors", () => {
	it("is typed as ancestor objects, not ids", () => {
		expectTypeOf<Category["ancestors"]>().toEqualTypeOf<CategoryAncestor[]>();
		expectTypeOf<CategoryAncestor>().toEqualTypeOf<{
			id: string;
			name: string | null;
			slug: string | null;
		}>();
	});

	it("comes back from categories.get() as objects, root first", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/categories/cat_14", body: SHIRTS },
		]);

		const category = await client(fake.fetch).categories.get("cat_14");

		expect(category?.ancestors).toEqual([
			{ id: "cat_2", name: "Kläder", slug: "klader" },
			{ id: "cat_7", name: null, slug: "herr" },
		]);
		expect(category?.ancestors.at(-1)?.id).toBe(category?.parentId);
	});

	it("is empty for a top-level category in categories.list()", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/categories",
				body: { data: [CLOTHING, SHIRTS], has_more: false, next_cursor: null },
			},
		]);

		const page = await client(fake.fetch).categories.list();

		expect(page.data.map((category) => category.ancestors)).toEqual([
			[],
			SHIRTS.ancestors,
		]);
	});

	it("feeds a breadcrumb with names and slugs and no extra request", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/categories/cat_14", body: SHIRTS },
		]);

		const category = await client(fake.fetch).categories.get("cat_14");
		const trail = category
			? [...category.ancestors, category].map(
					(entry) => entry.name ?? entry.slug,
				)
			: [];

		expect(trail).toEqual(["Kläder", "herr", "Skjortor"]);
		expect(fake.calls).toHaveLength(1);
	});
});
