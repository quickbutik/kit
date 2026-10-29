import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitApiError, ShopkitConfigError } from "../src/sdk/errors.js";
import { CartStore } from "../src/state/cart-store.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

const HANDOFF = {
	sessionId: "sess-1",
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	fields: {},
	data: {},
	checkout: "v2",
	hostedUrl: "https://checkout.test/checkout/42/sess-1",
};

const PATCH_ROUTE: FakeRoute = {
	match: "PATCH /v2/checkout/sessions/sess-1",
	body: { fields: {}, data: {} },
};

const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
});

/** Create, add, re-read for the handoff, hand off — `buyNow()` on a fresh visitor. */
function buyNowRoutes(handoff: unknown = HANDOFF): FakeRoute[] {
	return [
		{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		PATCH_ROUTE,
	];
}

function client(fetchImpl: typeof globalThis.fetch) {
	const storage = createMemoryStorage();
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

describe("checkout.buyNow()", () => {
	it("returns the handoff plus the cart the add produced", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.buyNow(
			{ productId: "prod_27", variantId: 10 },
			{ successUrl: "https://myshop.test/order" },
		);

		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
		expect(result.checkout).toBe("v2");
		expect(result.cart.itemCount).toBe(1);
		expect(result.cart.id).toBe("cart-1");
	});

	it("refuses a missing successUrl BEFORE adding anything", async () => {
		// Found only by start(), the item would already be in the basket behind a
		// thrown config error.
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.buyNow({ productId: "prod_27" }, {}),
		).rejects.toThrow(/checkout\.buyNow\(\) needs a successUrl/);
		expect(fake.calls).toHaveLength(0);
	});
});

describe("CartStore.buyNow()", () => {
	it("folds the cart into the store without an extra read", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		const result = await store.buyNow(
			{ productId: "prod_27", variantId: 10 },
			{ successUrl: "https://myshop.test/order" },
		);

		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
		const snapshot = store.getSnapshot();
		expect(snapshot.itemCount).toBe(1);
		expect(snapshot.status).toBe("ready");
		expect(snapshot.revision).toBe(1);
		expect(snapshot.pending).toBe(0);
		// create, add, the handoff's own cart read, handoff (+ a patch) — and no
		// store-side re-read on top.
		expect(
			fake.calls.filter((c) => c.method === "GET").map((c) => c.url),
		).toHaveLength(1);
	});

	it("throws a failed handoff, and re-reads the cart the add already changed", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 409,
				body: { message: "out of stock", statusCode: 409 },
			},
			// The store's recovery read.
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await expect(
			store.buyNow(
				{ productId: "prod_27", variantId: 10 },
				{ successUrl: "https://myshop.test/order" },
			),
		).rejects.toBeInstanceOf(ShopkitApiError);

		const snapshot = store.getSnapshot();
		// The badge shows the item that did land, and the cart itself is not
		// painted as broken — the checkout failed, not the cart.
		expect(snapshot.itemCount).toBe(1);
		expect(snapshot.status).toBe("ready");
		expect(snapshot.error).toBeNull();
		expect(snapshot.pending).toBe(0);
	});

	it("rethrows a config error without touching the network", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await expect(
			store.buyNow({ productId: "prod_27" }, { successUrl: "  " }),
		).rejects.toBeInstanceOf(ShopkitConfigError);
		expect(fake.calls).toHaveLength(0);
	});

	it("re-reads a remembered cart quietly after a config error", async () => {
		// Nothing was added here, but the store cannot tell this config error
		// from one thrown after the add — the re-read costs one request and no
		// `loading` flicker on the badges.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		const store = new CartStore(shopkit, FULL_CART.data as never);
		const seen: string[] = [];
		store.subscribe(() => seen.push(store.getSnapshot().status));

		await expect(
			store.buyNow({ productId: "prod_27" }, { successUrl: "  " }),
		).rejects.toBeInstanceOf(ShopkitConfigError);

		expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			"GET https://gateway.test/v2/cart/cart-1",
		]);
		expect(seen).not.toContain("loading");
		expect(store.getSnapshot().status).toBe("ready");
		expect(store.getSnapshot().itemCount).toBe(1);
	});

	it("re-reads the cart when a legacy handoff without an order id fails after the add", async () => {
		// `start()` throws a ShopkitConfigError for this one — but only after
		// the add landed, so the badge must still pick the item up.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					checkout: "legacy",
					cartId: "cart-1",
					hostedUrl: "https://legacy-checkout.test/checkout/42/x",
				},
			},
			// The store's recovery read.
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await expect(
			store.buyNow(
				{ productId: "prod_27", variantId: 10 },
				{ successUrl: "https://myshop.test/order" },
			),
		).rejects.toThrow(/carries no id/);

		const snapshot = store.getSnapshot();
		expect(snapshot.itemCount).toBe(1);
		expect(snapshot.cart?.id).toBe("cart-1");
		expect(snapshot.status).toBe("ready");
		expect(snapshot.error).toBeNull();
		expect(snapshot.pending).toBe(0);
		expect(
			fake.calls.filter((c) => c.method === "GET").map((c) => c.url),
		).toHaveLength(2);
	});

	it("keeps the snapshot as it was when the recovery read fails too", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 409,
				body: { message: "out of stock", statusCode: 409 },
			},
			{
				match: "GET /v2/cart/cart-1",
				status: 500,
				body: { message: "boom", statusCode: 500 },
			},
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await expect(
			store.buyNow(
				{ productId: "prod_27", variantId: 10 },
				{ successUrl: "https://myshop.test/order" },
			),
		).rejects.toBeInstanceOf(ShopkitApiError);

		// The checkout failed, and so did the re-read — neither is the cart's
		// error to show.
		const snapshot = store.getSnapshot();
		expect(snapshot.status).not.toBe("error");
		expect(snapshot.error).toBeNull();
		expect(snapshot.pending).toBe(0);
		expect(
			fake.calls.filter((c) => c.method === "GET").map((c) => c.url),
		).toHaveLength(2);
	});
});

describe("the legacy checkout's return leg", () => {
	const LEGACY_UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
	const LEGACY_HANDOFF = {
		checkout: "legacy",
		legacyOrderUuid: LEGACY_UUID,
		cartId: "cart-1",
		hostedUrl: `https://legacy-checkout.test/checkout/42/${LEGACY_UUID}`,
	};

	it("confirms a legacy order on the thank-you page the redirect lands on", async () => {
		// The platform sends a legacy shopper back to
		// `<successUrl origin>/success/<orderNumber>?t=&hash=` — the same return
		// as checkout-v2. Nothing kit-side branches: the uuid start() remembered
		// is what the thank-you page confirms with.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "POST /v2/checkout/handoff", status: 201, body: LEGACY_HANDOFF },
			{
				match: `GET /v2/checkout/sessions/${LEGACY_UUID}/confirmation`,
				body: { status: "completed", orderNumber: 5001 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);

		const started = await shopkit.checkout.buyNow(
			{ productId: "prod_27", variantId: 10 },
			{
				successUrl: "https://myshop.test/order",
				backUrl: "https://myshop.test/tee",
			},
		);
		expect(started.checkout).toBe("legacy");
		// successUrl and backUrl go to the platform on the legacy arm too — that
		// is what it builds the return and the back links from.
		const handoffBody = fake.calls.find((c) =>
			c.url.endsWith("/v2/checkout/handoff"),
		)?.body as Record<string, unknown>;
		expect(handoffBody.successUrl).toBe("https://myshop.test/order");
		expect(handoffBody.backUrl).toBe("https://myshop.test/tee");

		// …the shopper pays and lands on the storefront's own success route. No
		// `ppo`: the storefront is not on a host the shop owns.
		const landed = shopkit.checkout.parseReturnUrl(
			"https://myshop.test/success/5001?t=1735689600&hash=abc123",
		);
		expect(landed).toEqual({
			orderNumber: 5001,
			hash: "abc123",
			timestamp: 1735689600,
		});

		const handle = await shopkit.checkout.currentSessionId();
		expect(handle).toBe(LEGACY_UUID);
		const outcome = await shopkit.checkout.pollConfirmation(handle ?? "");
		expect(outcome).toMatchObject({ kind: "completed", orderNumber: 5001 });
		expect(outcome.kind === "completed" && outcome.orderNumber).toBe(
			landed?.orderNumber,
		);
		// Finalized: the bought cart and the handle are forgotten.
		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(await shopkit.checkout.currentSessionId()).toBeNull();
	});
});
