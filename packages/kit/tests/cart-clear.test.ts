import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitApiError } from "../src/sdk/errors.js";
import { CartStore } from "../src/state/cart-store.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	TEST_KEY,
} from "./helpers.js";

async function client(
	fetchImpl: typeof globalThis.fetch,
	remembered: string | null = "cart-1",
) {
	const storage = createMemoryStorage();
	if (remembered) await storage.set("qb_cart_id", remembered);
	await storage.set("qb_store_id", "42");
	const shopkit = createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage,
		maxRetries: 0,
	});
	return { shopkit, storage };
}

describe("cart.clear()", () => {
	it("deletes the remembered cart and forgets it", async () => {
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-1", status: 204, text: "" },
		]);
		const { shopkit, storage } = await client(fake.fetch);

		await shopkit.cart.clear();

		expect(
			fake.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
		).toEqual(["DELETE /v2/cart/cart-1"]);
		expect(await shopkit.cart.currentId()).toBeNull();
		// The store id rode in on that cart but names the shop, not the cart:
		// it is kept, so a thank-you page can still key its purchase on it.
		expect(await storage.get("qb_store_id")).toBe("42");
	});

	it("makes no request at all when there is no remembered cart", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = await client(fake.fetch, null);

		await shopkit.cart.clear();

		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		404, 410,
	])("still forgets the cart when the delete answers %i", async (status) => {
		// The goal was an empty basket and the shopper has one. Keeping the id
		// would make every later clear() retry a cart that will never resolve.
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				status,
				body: { message: "gone", statusCode: status },
			},
		]);
		const { shopkit } = await client(fake.fetch);

		await expect(shopkit.cart.clear()).resolves.toBeUndefined();
		expect(await shopkit.cart.currentId()).toBeNull();
	});

	it("keeps the id and throws on any other failure", async () => {
		// The cart may still exist server-side; forgetting it would strand the
		// shopper's items in a cart they can no longer reach.
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				status: 500,
				body: { message: "boom", statusCode: 500 },
			},
		]);
		const { shopkit } = await client(fake.fetch);

		await expect(shopkit.cart.clear()).rejects.toBeInstanceOf(ShopkitApiError);
		expect(await shopkit.cart.currentId()).toBe("cart-1");
	});
});

describe("CartStore.clear() / clearCart()", () => {
	it("goes through cart.clear(), so a vanished cart still ends up cleared", async () => {
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				status: 404,
				body: { message: "not found", statusCode: 404 },
			},
		]);
		const { shopkit } = await client(fake.fetch);
		const full = cartEnvelope({ items: [cartLine()], itemCount: 1 }).data;
		const store = new CartStore(shopkit, full as never);

		await store.clearCart();

		const snapshot = store.getSnapshot();
		expect(snapshot.cart).toBeNull();
		expect(snapshot.itemCount).toBe(0);
		expect(snapshot.status).toBe("ready");
		expect(snapshot.error).toBeNull();
		expect(snapshot.revision).toBe(1);
		expect(await shopkit.cart.currentId()).toBeNull();
	});

	it("is a no-op — no request, no revision — with nothing to clear", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = await client(fake.fetch, null);
		const store = new CartStore(shopkit);

		await store.clear();

		expect(fake.calls).toHaveLength(0);
		expect(store.getSnapshot().revision).toBe(0);
	});

	it("deletes the cart on screen when this browser remembers none", async () => {
		// A cart rendered from a server read (`initialCart`) with no id in local
		// storage: emptying the view alone would leave the basket alive.
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-1", status: 204, text: "" },
		]);
		const { shopkit } = await client(fake.fetch, null);
		const full = cartEnvelope({ items: [cartLine()], itemCount: 1 }).data;
		const store = new CartStore(shopkit, full as never);

		await store.clear();

		expect(
			fake.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
		).toEqual(["DELETE /v2/cart/cart-1"]);
		expect(store.getSnapshot().cart).toBeNull();
		expect(store.getSnapshot().revision).toBe(1);
	});

	it("prefers the remembered cart over the one on screen", async () => {
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-2", status: 204, text: "" },
		]);
		const { shopkit } = await client(fake.fetch, "cart-2");
		const full = cartEnvelope({ items: [cartLine()], itemCount: 1 }).data;
		const store = new CartStore(shopkit, full as never);

		await store.clear();

		expect(
			fake.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
		).toEqual(["DELETE /v2/cart/cart-2"]);
		expect(await shopkit.cart.currentId()).toBeNull();
	});

	it("captures a real failure on the snapshot instead of throwing", async () => {
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				status: 500,
				body: { message: "boom", statusCode: 500 },
			},
		]);
		const { shopkit } = await client(fake.fetch);
		const store = new CartStore(shopkit);

		await expect(store.clear()).resolves.toBeUndefined();
		expect(store.getSnapshot().status).toBe("error");
		expect(store.getSnapshot().pending).toBe(0);
	});
});
