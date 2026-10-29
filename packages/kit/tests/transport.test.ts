import { describe, expect, it, vi } from "vitest";
import { createShopkitClient } from "../src/sdk/client.js";
import {
	ShopkitApiError,
	ShopkitNetworkError,
	ShopkitScopeError,
} from "../src/sdk/errors.js";
import { unwrapEnvelope } from "../src/sdk/transport.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Record<string, unknown> = {},
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: "memory",
		maxRetries: 0,
		...overrides,
	});
}

describe("unwrapEnvelope", () => {
	it("unwraps api-core's { data, message, statusCode }", () => {
		expect(
			unwrapEnvelope({ data: { id: 1 }, message: "ok", statusCode: 200 }),
		).toEqual({
			id: 1,
		});
	});

	it("leaves a paginated collection alone", () => {
		const page = { data: [1], has_more: false, next_cursor: null };
		expect(unwrapEnvelope(page)).toBe(page);
	});

	it("leaves a bare resource alone", () => {
		const shop = { name: "Min butik" };
		expect(unwrapEnvelope(shop)).toBe(shop);
	});

	it("does not unwrap a resource that happens to own a `data` field", () => {
		const resource = { data: "x", name: "not an envelope" };
		expect(unwrapEnvelope(resource)).toBe(resource);
	});

	it("passes arrays and null through", () => {
		expect(unwrapEnvelope([1, 2])).toEqual([1, 2]);
		expect(unwrapEnvelope(null)).toBeNull();
	});
});

describe("auth + headers", () => {
	it("sends the publishable key as a bearer token", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
		]);
		await client(fake.fetch).shop.get();
		expect(fake.calls[0]?.headers.get("authorization")).toBe(
			`Bearer ${TEST_KEY}`,
		);
	});

	it("merges caller headers but never lets them override authorization", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
		]);
		await client(fake.fetch, {
			headers: { "x-trace": "abc", authorization: "Bearer nope" },
		}).shop.get();
		expect(fake.calls[0]?.headers.get("x-trace")).toBe("abc");
		expect(fake.calls[0]?.headers.get("authorization")).toBe(
			`Bearer ${TEST_KEY}`,
		);
	});

	it("strips a trailing /v2 from apiUrl so paths are not doubled", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
		]);
		await client(fake.fetch, { apiUrl: "https://gateway.test/v2/" }).shop.get();
		expect(fake.calls[0]?.url).toBe("https://gateway.test/v2/checkout/shop");
	});
});

describe("errors", () => {
	it("maps api-core's error envelope onto ShopkitApiError", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 400,
				body: {
					message: "Some cart items cannot be fulfilled",
					details: { items: [] },
				},
			},
		]);
		const error = await client(fake.fetch)
			.cart.create()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect((error as ShopkitApiError).message).toBe(
			"Some cart items cannot be fulfilled",
		);
		expect((error as ShopkitApiError).status).toBe(400);
		expect((error as ShopkitApiError).details).toEqual({ items: [] });
	});

	it("maps the gateway's problem+json onto ShopkitApiError", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 403,
				body: {
					title: "Forbidden",
					detail: "This operation requires admin authentication",
				},
			},
		]);
		const error = await client(fake.fetch)
			.products.list()
			.catch((e: unknown) => e);
		expect((error as ShopkitApiError).message).toBe(
			"This operation requires admin authentication",
		);
	});

	it("keeps a non-JSON body as text instead of throwing a parse error", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 502,
				text: "<html>bad gateway</html>",
			},
		]);
		const error = (await client(fake.fetch)
			.products.list()
			.catch((e: unknown) => e)) as ShopkitApiError;
		expect(error.status).toBe(502);
		expect(error.body).toContain("bad gateway");
		expect(error.retryable).toBe(true);
	});

	it("reports a transport failure as a network error, not an API error", async () => {
		const failing = vi.fn(async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof globalThis.fetch;
		const error = await client(failing)
			.shop.get()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitNetworkError);
	});

	it("returns null rather than throwing when a remembered id is gone", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", status: 404, body: {} },
		]);
		await expect(client(fake.fetch).cart.get("cart-1")).resolves.toBeNull();
	});
});

describe("abort", () => {
	it("reports an aborted request as a network error, not a timeout", async () => {
		const controller = new AbortController();
		controller.abort();
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [], has_more: false, next_cursor: null },
			},
		]);
		const error = await client(fake.fetch)
			.products.list({ signal: controller.signal })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitNetworkError);
	});

	it("still completes when the caller passes a live signal", async () => {
		// Regression guard: a runtime that exposes a broken `AbortSignal.any`
		// (happy-dom, partial polyfills) must not take the request down with it.
		const controller = new AbortController();
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [], has_more: false, next_cursor: null },
			},
		]);
		await expect(
			client(fake.fetch).products.list({ signal: controller.signal }),
		).resolves.toMatchObject({ data: [] });
	});
});

describe("retries", () => {
	it("retries a 500 and succeeds on the next attempt", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				status: 500,
				body: { message: "boom" },
			},
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
		]);
		const shop = await client(fake.fetch, { maxRetries: 1 }).shop.get();
		expect(shop.name).toBe("Min butik");
		expect(fake.calls).toHaveLength(2);
	});

	it("gives up after the retry budget and surfaces the last status", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				status: 503,
				body: { message: "down" },
			},
			{
				match: "GET /v2/checkout/shop",
				status: 503,
				body: { message: "down" },
			},
		]);
		const error = await client(fake.fetch, { maxRetries: 1 })
			.shop.get()
			.catch((e: unknown) => e);
		expect((error as ShopkitApiError).status).toBe(503);
		expect(fake.calls).toHaveLength(2);
	});

	it("does not retry a 4xx that cannot succeed on a repeat", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				status: 403,
				body: { message: "nope" },
			},
		]);
		await client(fake.fetch, { maxRetries: 2 })
			.shop.get()
			.catch(() => undefined);
		expect(fake.calls).toHaveLength(1);
	});
});

describe("401 key refresh", () => {
	it("adopts a refreshed key and retries once", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				status: 401,
				body: { message: "unauthorized" },
			},
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
		]);
		const rotated = "qb_pk_shop123_rotatedsecret";
		const onUnauthorized = vi.fn(() => rotated);

		const shop = await client(fake.fetch, { onUnauthorized }).shop.get();

		expect(shop.name).toBe("Min butik");
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
		expect(fake.calls[1]?.headers.get("authorization")).toBe(
			`Bearer ${rotated}`,
		);
	});

	it("surfaces the 401 when no refresh handler is configured", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				status: 401,
				body: { message: "unauthorized" },
			},
		]);
		const error = await client(fake.fetch)
			.shop.get()
			.catch((e: unknown) => e);
		expect((error as ShopkitApiError).status).toBe(401);
		expect(fake.calls).toHaveLength(1);
	});

	it("de-dupes concurrent refreshes into one call", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", status: 401, body: {} },
			{ match: "GET /v2/products", status: 401, body: {} },
			{ match: "GET /v2/checkout/shop", body: { name: "Min butik" } },
			{
				match: "GET /v2/products",
				body: { data: [], has_more: false, next_cursor: null },
			},
		]);
		const onUnauthorized = vi.fn(async () => "qb_pk_shop123_rotatedsecret");
		const shopkit = client(fake.fetch, { onUnauthorized });

		await Promise.all([shopkit.shop.get(), shopkit.products.list()]);

		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});
});

describe("products.search", () => {
	const page = { data: [{ id: "prod_1" }], has_more: false, next_cursor: null };

	it("serializes every filter onto the query string", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: page },
		]);

		await client(fake.fetch).products.search({
			search: "merino crew",
			sortBy: "price",
			sortOrder: "asc",
			minPrice: 20000,
			maxPrice: 90000,
			categoryId: "cat_12",
			limit: 24,
			cursor: "c2",
		});

		const url = new URL(fake.calls[0]?.url ?? "");
		expect(url.pathname).toBe("/v2/products/search");
		expect(url.searchParams.get("search")).toBe("merino crew");
		expect(url.searchParams.get("sortBy")).toBe("price");
		expect(url.searchParams.get("sortOrder")).toBe("asc");
		// Minor units go over the wire verbatim — no client-side division.
		expect(url.searchParams.get("minPrice")).toBe("20000");
		expect(url.searchParams.get("maxPrice")).toBe("90000");
		expect(url.searchParams.get("categoryId")).toBe("cat_12");
		expect(url.searchParams.get("limit")).toBe("24");
		expect(url.searchParams.get("cursor")).toBe("c2");
	});

	it("omits every parameter the caller left out", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: page },
		]);

		await client(fake.fetch).products.search();

		// A bare search must not send `?search=undefined` — the server would
		// treat that as a literal term and match nothing.
		expect(new URL(fake.calls[0]?.url ?? "").search).toBe("");
	});

	it("prefixes a numeric category id, which the gateway requires", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: page },
			{ match: "GET /v2/products/search", body: page },
		]);
		const sdk = client(fake.fetch);

		await sdk.products.search({ categoryId: 12 });
		await sdk.products.search({ categoryId: "cat_12" });

		// Regression guard: the gateway validates this param against its spec
		// pattern and 400s a bare `12`, so both input forms must leave as `cat_12`.
		for (const call of fake.calls) {
			expect(new URL(call.url).searchParams.get("categoryId")).toBe("cat_12");
		}
	});

	it("sends a zero lower bound rather than dropping it", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: page },
		]);

		await client(fake.fetch).products.search({ minPrice: 0 });

		// Guards the falsy-vs-undefined distinction in the query builder: 0 is a
		// meaningful bound ("free and up"), not an omitted one.
		expect(new URL(fake.calls[0]?.url ?? "").searchParams.get("minPrice")).toBe(
			"0",
		);
	});
});

describe("id normalisation on single reads", () => {
	// Regression guard: the gateway validates path params against
	// `^prod_\d+$` / `^cat_\d+$` and 400s a bare numeric id, which the public
	// API (including `<ProductImage productId>`) accepts.
	it("prefixes a numeric product id", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: { data: { id: "prod_27" } } },
		]);

		const product = await client(fake.fetch).products.get(27);

		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/products/prod_27",
		);
		expect(product?.id).toBe("prod_27");
	});

	it("leaves an already prefixed product id alone", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: { data: { id: "prod_27" } } },
		]);

		await client(fake.fetch).products.get("prod_27");

		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/products/prod_27",
		);
	});

	it("prefixes a numeric category id", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/categories/cat_12", body: { data: { id: "cat_12" } } },
		]);

		await client(fake.fetch).categories.get(12);

		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/categories/cat_12",
		);
	});

	it("leaves an already prefixed category id alone", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/categories/cat_12", body: { data: { id: "cat_12" } } },
		]);

		await client(fake.fetch).categories.get("cat_12");

		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/categories/cat_12",
		);
	});

	it("passes a non-numeric id through so the server explains it", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/nonsense", status: 404, body: {} },
		]);

		await expect(
			client(fake.fetch).products.get("nonsense"),
		).resolves.toBeNull();
		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/products/nonsense",
		);
	});
});

describe("product list paging", () => {
	it("walks pages with a size the upstream actually accepts", async () => {
		// The gateway asks upstream for `limit + 1`, so the page size has to stay
		// inside the cap with a row to spare.
		const page = (data: unknown[], more: boolean, cursor: string | null) => ({
			data,
			has_more: more,
			next_cursor: cursor,
		});
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([{ id: "prod_1" }], true, "c2") },
			{
				match: "GET /v2/products",
				body: page([{ id: "prod_2" }], false, null),
			},
		]);

		const all = await client(fake.fetch).products.listAll();

		expect(all.map((p) => p.id)).toEqual(["prod_1", "prod_2"]);
		for (const call of fake.calls) {
			const limit = Number(new URL(call.url).searchParams.get("limit"));
			expect(limit).toBeLessThan(100);
		}
		expect(new URL(fake.calls[1]?.url ?? "").searchParams.get("cursor")).toBe(
			"c2",
		);
	});

	it("stops at the last page rather than looping on a missing cursor", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				// has_more true but no cursor — a server that cannot paginate further.
				body: { data: [{ id: "prod_1" }], has_more: true, next_cursor: null },
			},
		]);

		const all = await client(fake.fetch).products.listAll();

		expect(all).toHaveLength(1);
		expect(fake.calls).toHaveLength(1);
	});
});

describe("scope pre-flight", () => {
	it("throws locally, before the request, when a scope is missing", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch, { scopes: ["products:read"] });
		const error = await shopkit.cart.create().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitScopeError);
		expect((error as ShopkitScopeError).required).toBe("cart:write");
		expect(fake.calls).toHaveLength(0);
	});

	it("names the operation and the declared scopes in the message", async () => {
		const shopkit = client(createFakeFetch([]).fetch, {
			scopes: ["products:read"],
		});
		await expect(shopkit.cart.create()).rejects.toThrow(/cart\.create\(\)/);
		await expect(shopkit.cart.create()).rejects.toThrow(/products:read/);
	});

	it("lets everything through when checking is disabled with null", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", body: { data: { id: "c" } } },
		]);
		const shopkit = client(fake.fetch, { scopes: null });
		await expect(shopkit.cart.create()).resolves.toBeTruthy();
	});

	it("treats admin:full as covering everything", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", body: { data: { id: "c" } } },
		]);
		const shopkit = client(fake.fetch, { scopes: ["admin:full"] });
		await expect(shopkit.cart.create()).resolves.toBeTruthy();
	});
});
