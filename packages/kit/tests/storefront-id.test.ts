import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { resolveConfig, type ShopkitConfig } from "../src/sdk/config.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import {
	clearProductCache,
	getProductPromise,
} from "../src/state/product-cache.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

const SF_ID = "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD";
const OTHER_SF_ID = "sf_01HZY7Q3N9M2K4P6R8T0V1W3X5";

const PRODUCT = { id: "prod_27", name: "Tee", slug: "tee", price: 9900 };
const PAGE = { data: [PRODUCT], has_more: false, next_cursor: null };

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Partial<ShopkitConfig> = {},
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		...overrides,
	});
}

/** The `storefrontId` query param of the nth request, or null when absent. */
function sentStorefrontId(
	fake: ReturnType<typeof createFakeFetch>,
	index = 0,
): string | null {
	const call = fake.calls[index];
	if (!call) throw new Error(`no request at index ${index}`);
	return new URL(call.url).searchParams.get("storefrontId");
}

describe("ShopkitConfig.storefrontId", () => {
	it("is shorthand for storefront: { id }, surface defaulted", () => {
		const resolved = resolveConfig({
			publishableKey: TEST_KEY,
			storefrontId: SF_ID,
		});
		expect(resolved.storefront).toEqual({ id: SF_ID, surface: "shopkit" });
		// Same storage separation as the long form.
		expect(resolved.storageKeyPrefix).toBe(`qb_${SF_ID.toLowerCase()}`);
	});

	it("accepts both when they name the same campaign, keeping storefront's surface", () => {
		const resolved = resolveConfig({
			publishableKey: TEST_KEY,
			storefront: { id: SF_ID, surface: "embed" },
			// Case-insensitive, as the platform compares them.
			storefrontId: SF_ID.toLowerCase(),
		});
		expect(resolved.storefront).toEqual({ id: SF_ID, surface: "embed" });
	});

	it("throws a ShopkitConfigError when the two disagree", () => {
		const build = () =>
			resolveConfig({
				publishableKey: TEST_KEY,
				storefront: { id: SF_ID },
				storefrontId: OTHER_SF_ID,
			});
		expect(build).toThrow(ShopkitConfigError);
		expect(build).toThrow(/two different campaign storefronts/);
	});

	it.each([null, "", "   "])("treats %j as not set", (value) => {
		const resolved = resolveConfig({
			publishableKey: TEST_KEY,
			storefrontId: value,
		});
		expect(resolved.storefront).toBeNull();
		expect(resolved.storageKeyPrefix).toBe("qb");
	});

	it("names a malformed id by the field it came from", () => {
		expect(() =>
			resolveConfig({ publishableKey: TEST_KEY, storefrontId: "sf_nope" }),
		).toThrow(/`storefrontId`/);
	});

	it("survives withStorage(), because the clone carries the binding", () => {
		const shopkit = client(createFakeFetch([]).fetch, { storefrontId: SF_ID });
		const clone = shopkit.withStorage(createMemoryStorage());
		expect(clone.storefront).toEqual({ id: SF_ID, surface: "shopkit" });
	});
});

describe("product reads on a bound client", () => {
	it("sends storefrontId on list, search and get", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products/search", body: PAGE },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const shopkit = client(fake.fetch, { storefrontId: SF_ID });

		await shopkit.products.list({ limit: 12 });
		await shopkit.products.search({ search: "tee" });
		await shopkit.products.get(27);

		expect([0, 1, 2].map((i) => sentStorefrontId(fake, i))).toEqual([
			SF_ID,
			SF_ID,
			SF_ID,
		]);
	});

	it("prices every page of a slug walk and listAll for the campaign", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [], has_more: true, next_cursor: "c2" },
			},
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { storefront: { id: SF_ID } });

		expect((await shopkit.products.getBySlug("tee"))?.id).toBe("prod_27");
		await shopkit.products.listAll();

		expect(fake.calls.map((_, i) => sentStorefrontId(fake, i))).toEqual([
			SF_ID,
			SF_ID,
			SF_ID,
		]);
	});

	it("lets one read name another campaign, or opt out with null", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products/search", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { storefrontId: SF_ID });

		await shopkit.products.get("prod_27", { storefrontId: OTHER_SF_ID });
		await shopkit.products.list({ storefrontId: null });
		// Empty reads as "not given" and falls back to the binding.
		await shopkit.products.search({ storefrontId: "" });

		expect(sentStorefrontId(fake, 0)).toBe(OTHER_SF_ID);
		expect(sentStorefrontId(fake, 1)).toBeNull();
		expect(sentStorefrontId(fake, 2)).toBe(SF_ID);
	});
});

describe("product reads on an unbound client", () => {
	it("send no storefrontId, byte-identical to before campaigns existed", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const shopkit = client(fake.fetch);

		await shopkit.products.list();
		await shopkit.products.get(27);

		expect(new URL(fake.calls[0]?.url ?? "").search).toBe("");
		expect(new URL(fake.calls[1]?.url ?? "").search).toBe("");
	});

	it("accept a per-call campaign — reads are stateless", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: PAGE },
		]);
		const shopkit = client(fake.fetch);

		await shopkit.products.search({ storefrontId: SF_ID });

		expect(sentStorefrontId(fake)).toBe(SF_ID);
	});

	it("refuse a malformed per-call id before the request goes out", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch);

		await expect(
			shopkit.products.get(27, { storefrontId: "sf_typo" }),
		).rejects.toThrow(ShopkitConfigError);
		expect(fake.calls).toHaveLength(0);
	});
});

describe("the product promise cache", () => {
	it("keys a per-call campaign apart from the client's default", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const shopkit = client(fake.fetch, { storefrontId: SF_ID });

		const byDefault = getProductPromise(shopkit, { id: 27 });
		const again = getProductPromise(shopkit, { id: 27 });
		const other = getProductPromise(shopkit, {
			id: 27,
			storefrontId: OTHER_SF_ID,
		});
		const none = getProductPromise(shopkit, { id: 27, storefrontId: null });
		await Promise.all([byDefault, other, none]);

		expect(again).toBe(byDefault);
		expect(other).not.toBe(byDefault);
		expect(none).not.toBe(byDefault);
		expect(fake.calls.map((_, i) => sentStorefrontId(fake, i))).toEqual([
			SF_ID,
			OTHER_SF_ID,
			null,
		]);
		clearProductCache(shopkit);
	});

	it("never shares an entry between clients bound to different campaigns", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const a = client(fake.fetch, { storefrontId: SF_ID });
		const b = client(fake.fetch, { storefrontId: OTHER_SF_ID });

		const fromA = getProductPromise(a, { id: 27 });
		const fromB = getProductPromise(b, { id: 27 });
		await Promise.all([fromA, fromB]);

		expect(fromA).not.toBe(fromB);
		expect(sentStorefrontId(fake, 0)).toBe(SF_ID);
		expect(sentStorefrontId(fake, 1)).toBe(OTHER_SF_ID);
	});
});
