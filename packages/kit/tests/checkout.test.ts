import { describe, expect, it, vi } from "vitest";
import {
	createMemoryStorage,
	type StorageAdapter,
} from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

function client(
	fetchImpl: typeof globalThis.fetch,
	storage = createMemoryStorage(),
) {
	return {
		shopkit: createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fetchImpl,
			storage,
			maxRetries: 0,
		}),
		storage,
	};
}

const SESSION = {
	sessionId: "sess-1",
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	theme: "light",
	fields: {},
	data: {},
};

/**
 * The URL the PLATFORM returns for a checkout-v2 handoff. Deliberately a
 * different host from the `checkoutUrl` the test client configures, so every
 * `start()` assertion below doubles as proof of the precedence rule: an
 * explicitly configured `checkoutUrl` beats the server's URL (that is what a
 * local environment or a merchant-domain proxy relies on).
 */
const PLATFORM_HANDOFF_URL =
	"https://platform-checkout.test/checkout/42/sess-1";

/** `POST /v2/checkout/handoff` answering with a checkout-v2 handoff. */
function v2Handoff(session: Record<string, unknown> = SESSION) {
	return { ...session, checkout: "v2", hostedUrl: PLATFORM_HANDOFF_URL };
}

describe("hostedUrl", () => {
	// The path segment is the shop's NUMERIC id (`Cart.storeId`, 42 in the
	// fixtures). The publishable key carries the shop's storage PREFIX
	// (`shop123` here, `101928Y` in production) — a CDN folder name the hosted
	// checkout answers with "We couldn't find 101928Y". It must never end up in
	// this URL.

	it("builds /checkout/{storeId}/{sessionId} from an explicit numeric store id", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({ sessionId: "sess-1", storeId: 101928 }),
		).toBe("https://checkout.test/checkout/101928/sess-1");
	});

	it("takes the store id as a string too", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({ sessionId: "s", storeId: "9020" }),
		).toContain("/checkout/9020/s");
	});

	it("uses the store id remembered from the last cart the client received", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
		]);
		const { shopkit } = client(fake.fetch);
		await shopkit.cart.get("cart-1");

		expect(shopkit.checkout.hostedUrl("sess-1")).toBe(
			"https://checkout.test/checkout/42/sess-1",
		);
	});

	it("reads a store id a previous request left in synchronous storage", () => {
		// A fresh client (a new server request, a page reload) with nothing in
		// memory: memory, localStorage, document.cookie and a request cookie jar
		// all answer `get()` synchronously, so the remembered id is still there.
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "77");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);

		expect(shopkit.checkout.hostedUrl("sess-1")).toBe(
			"https://checkout.test/checkout/77/sess-1",
		);
	});

	it("cannot read an async-only storage synchronously, and says so rather than guess", async () => {
		// Next's `cookies()` can only be awaited. Until a cart has been read in
		// this request there is no id to build from — and the key's prefix is
		// never an acceptable stand-in.
		const memory = createMemoryStorage();
		await memory.set("qb_store_id", "77");
		const asyncStorage: StorageAdapter = {
			kind: "cookie",
			get: async (key) => memory.get(key),
			set: async (key, value, options) => memory.set(key, value, options),
			remove: async (key) => memory.remove(key),
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
		]);
		const { shopkit } = client(fake.fetch, asyncStorage);

		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(
			ShopkitConfigError,
		);

		// Once a cart has passed through, the id is in memory and the call works.
		await shopkit.cart.get("cart-1");
		expect(shopkit.checkout.hostedUrl("sess-1")).toContain("/checkout/42/");
	});

	it("rejects the key's shop prefix passed explicitly — the beta.3 migration trap", () => {
		// The deprecated `shopkit.shopId` getter returns the key's prefix, which
		// code written against beta.3 may still pass here. A URL built from it 404s.
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "77");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);

		for (const input of [
			{ sessionId: "s", shopId: shopkit.shopId },
			{ sessionId: "s", storeId: shopkit.shopPrefix },
		]) {
			expect(() => shopkit.checkout.hostedUrl(input)).toThrow(
				ShopkitConfigError,
			);
			expect(() => shopkit.checkout.hostedUrl(input)).toThrow(/shop prefix/);
			expect(() => shopkit.checkout.hostedUrl(input)).toThrow(/cart\.storeId/);
		}
	});

	it("rejects a non-numeric store id instead of building a URL from it", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(() =>
			shopkit.checkout.hostedUrl({ sessionId: "s", storeId: "x y" }),
		).toThrow(/numeric store id/);
		expect(() =>
			shopkit.checkout.hostedUrl({ sessionId: "s", shopId: "101928Y" }),
		).toThrow(ShopkitConfigError);
	});

	it("treats a non-numeric remembered value as not remembered", () => {
		// The cookie is writable by anyone; only `Cart.storeId` shapes count.
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "shop123");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(/none is known/);
	});

	it("does not let a rejecting async adapter escape as an unhandled rejection", async () => {
		// A BYO Redis/KV adapter whose read fails: hostedUrl() must throw its own
		// named error and nothing else. Vitest fails the run on an unhandled
		// rejection, so flushing the microtask queue here is the assertion.
		const rejecting: StorageAdapter = {
			kind: "redis",
			get: async () => {
				throw new Error("redis down");
			},
			set: async () => undefined,
			remove: async () => undefined,
		};
		const { shopkit } = client(createFakeFetch([]).fetch, rejecting);

		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(
			ShopkitConfigError,
		);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).not.toThrow(
			/redis down/,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("does not let a synchronously throwing adapter escape hostedUrl()", () => {
		const throwing: StorageAdapter = {
			kind: "broken",
			get: () => {
				throw new Error("boom");
			},
			set: () => undefined,
			remove: () => undefined,
		};
		const { shopkit } = client(createFakeFetch([]).fetch, throwing);

		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(
			ShopkitConfigError,
		);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).not.toThrow(/boom/);
	});

	it("throws when no store id is known — never falls back to the key's shop prefix", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);

		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(
			ShopkitConfigError,
		);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(/cart\.storeId/);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).toThrow(
			/checkout\.start\(\)/,
		);
		expect(() => shopkit.checkout.hostedUrl("sess-1")).not.toThrow(/shop123/);
	});

	it("prefers an explicit store id over the remembered one", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
		]);
		const { shopkit } = client(fake.fetch);
		await shopkit.cart.get("cart-1");

		expect(
			shopkit.checkout.hostedUrl({ sessionId: "s", storeId: 9020 }),
		).toContain("/checkout/9020/s");
	});

	it("still accepts the deprecated `shopId` input spelling", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({ sessionId: "s", shopId: "9020" }),
		).toContain("/checkout/9020/s");
	});

	it("prefers `storeId` when both spellings are given", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({
				sessionId: "s",
				storeId: 1,
				shopId: "2",
			}),
		).toContain("/checkout/1/s");
	});

	it("treats a blank explicit store id as absent", () => {
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "77");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);
		expect(
			shopkit.checkout.hostedUrl({ sessionId: "s", storeId: "  " }),
		).toContain("/checkout/77/s");
	});

	it("appends the language as ?lang for a flash-free first paint", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({
				sessionId: "sess-1",
				storeId: 42,
				language: "sv",
			}),
		).toBe("https://checkout.test/checkout/42/sess-1?lang=sv");
	});

	it("percent-encodes the session id", () => {
		// The store id is numeric by contract, so only the session id can carry
		// characters that need escaping.
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.hostedUrl({ sessionId: "a/b", storeId: "42" }),
		).toBe("https://checkout.test/checkout/42/a%2Fb");
	});

	it("rejects an empty session id instead of building a broken URL", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(() => shopkit.checkout.hostedUrl("")).toThrow(/sessionId/);
	});
});

describe("rememberedStoreId", () => {
	// The synchronous, request-free sibling of `hostedUrl()`'s lookup: what a
	// thank-you page reads for the purchase dedup key once the cart is gone.

	it("is null on a fresh client", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(shopkit.checkout.rememberedStoreId()).toBeNull();
	});

	it("is the store id off the last cart the client read", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const { shopkit } = client(fake.fetch, storage);
		expect(shopkit.checkout.rememberedStoreId()).toBeNull();

		await shopkit.cart.current();

		expect(shopkit.checkout.rememberedStoreId()).toBe("42");
	});

	it("reads an id a previous request left in synchronous storage", () => {
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "77");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);

		expect(shopkit.checkout.rememberedStoreId()).toBe("77");
	});

	it("prefers the copy remembered with the checkout session", async () => {
		// The cart's copy dies with the cart; the session's is the one still
		// alive on the thank-you page, so it is the one consulted first.
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ storeId: 42 }),
			},
			{ match: "POST /v2/checkout/handoff", status: 201, body: v2Handoff() },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await shopkit.checkout.start({ successUrl: "https://myshop.test/order" });
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");

		// The platform drops the cart once the order exists.
		await storage.remove("qb_cart_id");
		await storage.remove("qb_store_id");
		const fresh = client(createFakeFetch([]).fetch, storage);

		expect(fresh.shopkit.checkout.rememberedStoreId()).toBe("42");
		expect(await storage.get("qb_checkout_store")).toBe("42");
	});

	it("survives the cart being found gone and the completed confirmation, so a reload builds the same key", async () => {
		// The thank-you page sequence on a redirect PSP: a header badge reads
		// the cart (the platform dropped it with the order: 404), the poll
		// completes (`finalize()` forgets the session and its copy of the id),
		// the shopper reloads. Every read along the way must answer the same
		// numeric id, or the purchase dedup key changes and the order is
		// reported twice.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", status: 404, body: {} },
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_store_id", "42");
		await storage.set("qb_checkout_session", "sess-1");
		await storage.set("qb_checkout_store", "42");
		const { shopkit } = client(fake.fetch, storage);
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");

		await expect(shopkit.cart.current()).resolves.toBeNull();
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");

		await shopkit.checkout.finalize();
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");

		const reloaded = client(createFakeFetch([]).fetch, storage);
		expect(reloaded.shopkit.checkout.rememberedStoreId()).toBe("42");
		expect(await storage.get("qb_store_id")).toBe("42");
		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(await storage.get("qb_checkout_store")).toBeNull();
	});

	it("ignores a remembered value that is not a numeric store id", () => {
		// The cookie is writable by anyone; only `Cart.storeId` shapes count.
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "shop123");
		storage.set("qb_checkout_store", "not-a-shop");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);

		expect(shopkit.checkout.rememberedStoreId()).toBeNull();
	});

	it("falls through a bad session copy to a good cart copy", () => {
		const storage = createMemoryStorage();
		storage.set("qb_store_id", "42");
		storage.set("qb_checkout_store", "shop123");
		const { shopkit } = client(createFakeFetch([]).fetch, storage);

		expect(shopkit.checkout.rememberedStoreId()).toBe("42");
	});
});

describe("createSession", () => {
	it("posts the session and remembers it", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			// Fetched to compare the session's cart snapshot against the live cart
			// — see the "stale session cart" suite.
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit, storage } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			backUrl: "https://myshop.test/",
			language: "sv",
			prefill: { customer: { email: "a@b.test", postalCode: "11122" } },
		});

		expect(session.sessionId).toBe("sess-1");
		expect(await storage.get("qb_checkout_session")).toBe("sess-1");
		expect(fake.calls[0]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			backUrl: "https://myshop.test/",
			language: "sv",
			prefill: { customer: { email: "a@b.test", postalCode: "11122" } },
		});
	});

	it("leaves backUrl out of the body when the caller did not set one", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		// The server falls back to the shop's storefront URL, then the
		// successUrl origin — an absent key, not `backUrl: null`, is what lets it.
		expect(fake.calls[0]?.body).not.toHaveProperty("backUrl");
		expect(session.backUrl).toBeNull();
	});

	it("forwards theme so a dark storefront gets a dark checkout", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: { ...SESSION, theme: "dark" },
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			theme: "dark",
		});

		expect(fake.calls[0]?.body).toMatchObject({ theme: "dark" });
		expect(session.theme).toBe("dark");
	});

	it("forwards an explicit light theme, which is not the same as omitting it", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			theme: "light",
		});

		// Sent, not dropped: this asks for light even on a shop whose own
		// default is dark, which omitting the key would not.
		expect(fake.calls[0]?.body).toMatchObject({ theme: "light" });
	});

	it("leaves theme out of the body when the caller did not set one", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		// Absent, not `theme: "light"` — an absent key is what lets the shop's
		// own theme apply, and sending one would override it.
		expect(fake.calls[0]?.body).not.toHaveProperty("theme");
		expect(session.theme).toBe("light");
	});

	it("reports the shop's theme back when the caller asked for none", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: { ...SESSION, theme: "dark" },
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		// The response carries what the shopper will actually see, which here
		// is the merchant's choice rather than anything this caller sent.
		expect(fake.calls[0]?.body).not.toHaveProperty("theme");
		expect(session.theme).toBe("dark");
	});
});

describe("start", () => {
	it("ensures a cart, creates the session and returns the handoff URL", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: v2Handoff() },
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		// `42` is the cart's `storeId`; `shop123` is the key's prefix, which the
		// hosted checkout does not recognise.
		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
		expect(fake.calls[1]?.body).toMatchObject({ cartId: "cart-1" });
	});

	it("builds the URL from the cart's store id, not from a remembered one", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/cart/cart-1",
				body: cartEnvelope({ storeId: 101928 }),
			},
			{ match: "POST /v2/checkout/handoff", status: 201, body: v2Handoff() },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_store_id", "999");

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			language: "sv",
		});

		expect(result.url).toBe(
			"https://checkout.test/checkout/101928/sess-1?lang=sv",
		);
		expect(result.url).not.toContain("shop123");
	});

	it("refuses to start from a cart that does not exist", async () => {
		// The session create would 404 on the same cart, and there is no correct
		// store id to build a URL from — fail here, by name.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/missing", status: 404, body: {} },
		]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.start({
				cartId: "missing",
				successUrl: "https://myshop.test/order",
			}),
		).rejects.toThrow(/cart missing does not exist/);
		expect(fake.calls.map((c) => c.method)).toEqual(["GET"]);
	});

	it("forwards backUrl so the checkout's continue-shopping links come home", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: v2Handoff({ ...SESSION, backUrl: "https://myshop.test/" }),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			backUrl: "https://myshop.test/",
		});

		expect(fake.calls[1]?.body).toMatchObject({
			backUrl: "https://myshop.test/",
		});
		expect(result.checkout).toBe("v2");
		expect(result.session?.backUrl).toBe("https://myshop.test/");
	});

	it("forwards theme through the handoff too", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: v2Handoff({ ...SESSION, theme: "dark" }),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			theme: "dark",
		});

		expect(fake.calls[1]?.body).toMatchObject({ theme: "dark" });
		expect(result.session?.theme).toBe("dark");
	});

	it("reports the shop's theme from a handoff that asked for none", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: v2Handoff({ ...SESSION, theme: "dark" }),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(fake.calls[1]?.body).not.toHaveProperty("theme");
		expect(result.session?.theme).toBe("dark");
	});

	it("uses an explicit cartId without touching the remembered one", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/cart/given-cart",
				body: cartEnvelope({ id: "given-cart" }),
			},
			{ match: "POST /v2/checkout/handoff", status: 201, body: v2Handoff() },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "remembered-cart");

		await shopkit.checkout.start({
			cartId: "given-cart",
			successUrl: "https://myshop.test/order",
		});

		// The given cart is read (to compare against the session snapshot) and used;
		// the remembered one is never touched.
		expect(fake.calls.map((c) => new URL(c.url).pathname)).toEqual([
			"/v2/cart/given-cart",
			"/v2/checkout/handoff",
		]);
		expect(fake.calls[1]?.body).toMatchObject({ cartId: "given-cart" });
		expect(await storage.get("qb_cart_id")).toBe("remembered-cart");
	});
});

describe("start on a legacy-checkout shop", () => {
	const LEGACY_UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
	const LEGACY_URL = `https://legacy-checkout.test/checkout/42/${LEGACY_UUID}`;

	function legacyHandoff(hostedUrl: string | null = LEGACY_URL) {
		return {
			checkout: "legacy",
			legacyOrderUuid: LEGACY_UUID,
			cartId: "cart-1",
			hostedUrl,
		};
	}

	it("hands back the platform's URL, which names an order and not a session", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: legacyHandoff(),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.checkout).toBe("legacy");
		expect(result.url).toBe(LEGACY_URL);
		expect(result.legacyOrderUuid).toBe(LEGACY_UUID);
		// No session exists on this branch — there is nothing to patch or re-read.
		expect(result.session).toBeUndefined();
	});

	it("uses the platform's URL even though checkoutUrl is configured", async () => {
		// The configured `checkoutUrl` is the checkout-v2 host. Letting it win here
		// would point the shopper at a checkout this shop does not run, at a path
		// segment (an order uuid) that checkout cannot resolve.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: legacyHandoff(),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.url).toBe(LEGACY_URL);
		expect(new URL(result.url).host).toBe("legacy-checkout.test");
	});

	it("remembers the legacy order uuid as the handle to confirm with", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: legacyHandoff(),
			},
			{
				match: `GET /v2/checkout/sessions/${LEGACY_UUID}/confirmation`,
				body: { status: "completed", orderNumber: 5001 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});
		expect(await storage.get("qb_checkout_session")).toBe(LEGACY_UUID);
		expect(await shopkit.checkout.currentSessionId()).toBe(LEGACY_UUID);

		// The SAME confirmation call as checkout-v2 — the platform resolves whether
		// the handle is a session id or a legacy order uuid, so the SDK does not
		// branch and neither does the caller.
		const confirmation = await shopkit.checkout.confirmation(result.handoffId);
		expect(confirmation.orderNumber).toBe(5001);
	});

	it("refuses a handoff with no order uuid to confirm by", async () => {
		// hostedUrl and the uuid go missing together in practice, but the uuid is
		// what the return leg needs — a handoff without it is a dead end.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: { ...legacyHandoff(), legacyOrderUuid: null },
			},
		]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.start({ successUrl: "https://myshop.test/order" }),
		).rejects.toThrow(ShopkitConfigError);
	});

	it("throws by name when the platform could not prepare a link", async () => {
		// Nothing local to fall back on: the URL names an order only the platform
		// can create, on a host only it knows.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: legacyHandoff(null),
			},
		]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.start({ successUrl: "https://myshop.test/order" }),
		).rejects.toThrow(ShopkitConfigError);
	});
});

describe("start URL precedence on checkout-v2", () => {
	/** A client that left `checkoutUrl` at its default — the only configuration
	 *  in which the platform's answer is allowed to decide anything. */
	function defaultUrlClient(fetchImpl: typeof globalThis.fetch) {
		return createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fetchImpl,
			storage: createMemoryStorage(),
			maxRetries: 0,
		});
	}

	it("builds locally when the platform omits the field (an older api-core)", async () => {
		// No `checkoutUrl` configured, so this genuinely exercises the fallback —
		// with the `client()` helper it would pass even if the fallback were gone.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				// `hostedUrl` ABSENT, not null: a platform version older than the field.
				body: { ...SESSION, checkout: "v2" },
			},
		]);
		const shopkit = defaultUrlClient(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.url).toBe("https://pay.quickbutik.com/checkout/42/sess-1");
	});

	it("refuses to guess the production host when the platform says it has none", async () => {
		// An explicit null is an OPINION ("no host configured for this shop"), not
		// a gap. Falling back to DEFAULT_CHECKOUT_URL here would send a shopper on
		// a preview or local environment to the production checkout with a session
		// it never issued — the exact "we couldn't find it" this endpoint prevents.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: { ...SESSION, checkout: "v2", hostedUrl: null },
			},
		]);
		const shopkit = defaultUrlClient(fake.fetch);

		await expect(
			shopkit.checkout.start({ successUrl: "https://myshop.test/order" }),
		).rejects.toThrow(ShopkitConfigError);
	});

	it("still honours a configured checkoutUrl when the platform sends null", async () => {
		// A storefront that knows where its own checkout lives is not blocked by
		// the platform having no host configured.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: { ...SESSION, checkout: "v2", hostedUrl: null },
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
	});

	it("prefers the platform's URL when checkoutUrl was left at its default", async () => {
		// No `checkoutUrl` in the config: the platform knows where its own checkout
		// lives, and a hardcoded default would go stale the day it moves.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: v2Handoff() },
		]);
		const shopkit = defaultUrlClient(fake.fetch);

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.url).toBe(PLATFORM_HANDOFF_URL);
	});
});

describe("stale session cart", () => {
	/** A session response whose cart snapshot holds `items`. */
	function sessionWith(items: Array<Record<string, unknown>>) {
		return {
			...SESSION,
			fields: {
				cart: {
					value: { items, currency: "SEK" },
					status: "valid",
					errors: [],
					updatedAt: null,
				},
			},
			data: {},
		};
	}

	const liveCart = (items: Array<Record<string, unknown>>) =>
		cartEnvelope({
			items,
			itemCount: items.reduce((n, i) => n + Number(i.quantity ?? 0), 0),
		});

	it("re-reads the cart when the session returns a stale snapshot", async () => {
		// `POST /checkout/sessions` is idempotent on cartId server-side: a shopper
		// who goes to checkout, comes back, adds an item and sets off again gets
		// the FIRST session, with the cart as it looked then. Without a resync
		// their new line silently never reaches the checkout.
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([{ productId: "1", quantity: 5 }]),
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: {
					fields: {
						cart: {
							value: {
								items: [
									{ productId: "1", quantity: 5 },
									{ productId: "27", variantId: "10", quantity: 1 },
								],
								currency: "SEK",
							},
							status: "valid",
							errors: [],
							updatedAt: null,
						},
					},
					data: { pricing: { value: { subtotal: 243400 }, resolvedAt: null } },
					invalidatedFields: [],
					resolvedData: ["pricing"],
					isComplete: false,
				},
			},
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{
				cart: liveCart([
					{ productId: 1, quantity: 5 },
					{ productId: 27, variantId: 10, quantity: 1 },
				]).data as never,
			},
		);

		// The rehydrate body is `{ cart: {} }` — the server re-reads the cart, so
		// prices are never client-supplied.
		expect(fake.calls[1]?.body).toEqual({ cart: {} });
		// …and the returned session carries the refreshed state, not the stale one.
		expect(
			(session.fields.cart?.value as { items: unknown[] }).items,
		).toHaveLength(2);
		expect(session.data.pricing?.value).toEqual({ subtotal: 243400 });
	});

	it("does not patch when the snapshot already matches the cart", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([
					{ productId: "1", quantity: 5 },
					{ productId: "27", variantId: "10", quantity: 1 },
				]),
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{
				cart: liveCart([
					{ productId: 1, quantity: 5 },
					{ productId: 27, variantId: 10, quantity: 1 },
				]).data as never,
			},
		);

		// One call only: a session the shopper may be midway through must not be
		// disturbed for nothing.
		expect(fake.calls).toHaveLength(1);
	});

	it("ignores line order and id formatting when comparing", async () => {
		// The snapshot stores ids as strings ("27"); the Cart API returns numbers.
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([
					{ productId: "27", variantId: "10", quantity: 1 },
					{ productId: "1", quantity: 5 },
				]),
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{
				cart: liveCart([
					{ productId: 1, quantity: 5 },
					{ productId: 27, variantId: 10, quantity: 1 },
				]).data as never,
			},
		);

		expect(fake.calls).toHaveLength(1);
	});

	it("treats a changed quantity as stale", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([{ productId: "1", quantity: 5 }]),
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: {
					fields: {},
					data: {},
					invalidatedFields: [],
					resolvedData: [],
					isComplete: false,
				},
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{ cart: liveCart([{ productId: 1, quantity: 6 }]).data as never },
		);

		expect(fake.calls).toHaveLength(2);
	});

	it("distinguishes two variants of the same product", async () => {
		// The ONLY difference is the variant id — a comparison keyed on productId
		// alone would call this unchanged and lose the swap.
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([{ productId: "27", variantId: "10", quantity: 1 }]),
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: {
					fields: {},
					data: {},
					invalidatedFields: [],
					resolvedData: [],
					isComplete: false,
				},
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{
				cart: liveCart([{ productId: 27, variantId: 9, quantity: 1 }])
					.data as never,
			},
		);

		expect(fake.calls).toHaveLength(2);
	});

	it("start() resolves the cart once and reuses it for the check", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/cart/cart-1",
				body: liveCart([{ productId: 1, quantity: 5 }]),
			},
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: v2Handoff(sessionWith([{ productId: "1", quantity: 5 }])),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");

		const result = await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
		});

		expect(result.session?.sessionId).toBe("sess-1");
		// GET cart + POST session. No second cart fetch inside createSession.
		expect(fake.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
	});

	it("syncCart refreshes an existing session on demand", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1",
				body: {
					...sessionWith([{ productId: "1", quantity: 5 }]),
					isComplete: false,
					blockingFields: [],
				},
			},
			{
				match: "GET /v2/cart/cart-1",
				body: liveCart([
					{ productId: 1, quantity: 5 },
					{ productId: 27, variantId: 10, quantity: 1 },
				]),
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: {
					fields: {
						cart: {
							value: { items: [1, 2] },
							status: "valid",
							errors: [],
							updatedAt: null,
						},
					},
					data: {},
					invalidatedFields: [],
					resolvedData: [],
					isComplete: false,
				},
			},
		]);
		const { shopkit } = client(fake.fetch);

		const synced = await shopkit.checkout.syncCart("sess-1");

		expect(fake.calls).toHaveLength(3);
		expect(
			(synced?.fields.cart?.value as { items: unknown[] }).items,
		).toHaveLength(2);
	});

	it("syncCart is null for a session that does not exist", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/gone", status: 404, body: {} },
		]);
		const { shopkit } = client(fake.fetch);
		await expect(shopkit.checkout.syncCart("gone")).resolves.toBeNull();
	});

	it("leaves the session alone when the cart itself has vanished", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith([{ productId: "1", quantity: 5 }]),
			},
			{ match: "GET /v2/cart/cart-1", status: 404, body: {} },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		// No patch: a missing cart is not something a rehydrate can repair, and the
		// real error belongs at checkout rather than here.
		expect(fake.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
		expect(session.sessionId).toBe("sess-1");
	});
});

describe("parseReturnUrl", () => {
	it("reads the order number, hash and timestamp the checkout appends", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.parseReturnUrl(
				"https://myshop.test/success/1234?hash=abc&t=1750000000",
			),
		).toEqual({ orderNumber: 1234, hash: "abc", timestamp: 1750000000 });
	});

	it("accepts a bare path and a trailing slash", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(shopkit.checkout.parseReturnUrl("/success/77/")?.orderNumber).toBe(
			77,
		);
	});

	it("is null for anything that is not a success return", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(
			shopkit.checkout.parseReturnUrl("https://myshop.test/cart"),
		).toBeNull();
		expect(shopkit.checkout.parseReturnUrl("/success/not-a-number")).toBeNull();
		expect(shopkit.checkout.parseReturnUrl("::::")).toBeNull();
	});
});

describe("pollConfirmation", () => {
	it("resolves completed and clears the remembered ids", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 5001 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_checkout_session", "sess-1");

		const outcome = await shopkit.checkout.pollConfirmation("sess-1");

		expect(outcome).toEqual({
			kind: "completed",
			orderNumber: 5001,
			confirmation: { status: "completed", orderNumber: 5001 },
		});
		// A bought cart must not come back to life on the next visit.
		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(await storage.get("qb_checkout_session")).toBeNull();
	});

	it("keeps polling through processing_payment until the order lands", async () => {
		vi.useFakeTimers();
		try {
			const fake = createFakeFetch([
				{
					match: "GET /v2/checkout/sessions/sess-1/confirmation",
					body: { status: "processing_payment", retryAfterMs: 1500 },
				},
				{
					match: "GET /v2/checkout/sessions/sess-1/confirmation",
					body: { status: "completed", orderNumber: 42 },
				},
			]);
			const { shopkit } = client(fake.fetch);
			const seen: string[] = [];

			const pending = shopkit.checkout.pollConfirmation("sess-1", {
				onUpdate: (c) => seen.push(c.status),
			});
			await vi.runAllTimersAsync();
			const outcome = await pending;

			expect(seen).toEqual(["processing_payment", "completed"]);
			expect(outcome.kind).toBe("completed");
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops immediately on a terminal payment failure", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "failed" },
			},
		]);
		const { shopkit } = client(fake.fetch);

		const outcome = await shopkit.checkout.pollConfirmation("sess-1");

		expect(outcome.kind).toBe("failed");
		expect(fake.calls).toHaveLength(1);
	});

	it("times out rather than hanging when the order never lands", async () => {
		vi.useFakeTimers();
		try {
			const fake = createFakeFetch(
				Array.from({ length: 5 }, () => ({
					match: "GET /v2/checkout/sessions/sess-1/confirmation",
					body: { status: "processing_payment" as const },
				})),
			);
			const { shopkit } = client(fake.fetch);

			const pending = shopkit.checkout.pollConfirmation("sess-1", {
				maxPolls: 3,
			});
			await vi.runAllTimersAsync();
			const outcome = await pending;

			expect(outcome).toEqual({
				kind: "timeout",
				lastStatus: "processing_payment",
			});
			expect(fake.calls).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports aborted when the caller cancels", async () => {
		const controller = new AbortController();
		controller.abort();
		const { shopkit } = client(createFakeFetch([]).fetch);

		const outcome = await shopkit.checkout.pollConfirmation("sess-1", {
			signal: controller.signal,
		});

		expect(outcome).toEqual({ kind: "aborted" });
	});

	it("survives a transient failed poll and still completes", async () => {
		vi.useFakeTimers();
		try {
			const fake = createFakeFetch([
				{
					match: "GET /v2/checkout/sessions/sess-1/confirmation",
					status: 500,
					body: { message: "boom" },
				},
				{
					match: "GET /v2/checkout/sessions/sess-1/confirmation",
					body: { status: "completed", orderNumber: 9 },
				},
			]);
			const { shopkit } = client(fake.fetch);

			const pending = shopkit.checkout.pollConfirmation("sess-1", {
				maxPolls: 3,
			});
			await vi.runAllTimersAsync();

			expect((await pending).kind).toBe("completed");
		} finally {
			vi.useRealTimers();
		}
	});
});
