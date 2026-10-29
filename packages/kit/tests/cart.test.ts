import { describe, expect, it, vi } from "vitest";
import {
	createMemoryStorage,
	type StorageAdapter,
} from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { type CartMutationEvent, CartStore } from "../src/state/cart-store.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

function client(
	fetchImpl: typeof globalThis.fetch,
	storage = createMemoryStorage(),
) {
	return {
		shopkit: createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fetchImpl,
			storage,
			maxRetries: 0,
		}),
		storage,
	};
}

describe("cart.current", () => {
	it("is null — and makes no request — when nothing is remembered", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);
		await expect(shopkit.cart.current()).resolves.toBeNull();
		expect(fake.calls).toHaveLength(0);
	});

	it("forgets a remembered id the server no longer knows", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/stale", status: 404, body: {} },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "stale");

		await expect(shopkit.cart.current()).resolves.toBeNull();
		expect(await storage.get("qb_cart_id")).toBeNull();
	});
});

describe("cart.ensure", () => {
	it("creates and remembers a cart on first use", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit, storage } = client(fake.fetch);

		const cart = await shopkit.cart.ensure();

		expect(cart.id).toBe("cart-1");
		expect(await storage.get("qb_cart_id")).toBe("cart-1");
	});

	it("reuses the remembered cart instead of creating a second one", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ itemCount: 2 }) },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");

		const cart = await shopkit.cart.ensure();

		expect(cart.itemCount).toBe(2);
		expect(fake.calls.map((c) => c.method)).toEqual(["GET"]);
	});
});

describe("cart.add", () => {
	it("creates the cart and adds in one flow", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const cart = await shopkit.cart.add({ productId: "prod_1", quantity: 2 });

		expect(cart.itemCount).toBe(1);
		expect(fake.calls[1]?.body).toEqual({ productId: "prod_1", quantity: 2 });
	});

	it("defaults quantity to 1", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope(),
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.add({ productId: 7 });

		expect(fake.calls[1]?.body).toEqual({ productId: 7, quantity: 1 });
	});

	it("recovers once from a remembered cart the server has dropped", async () => {
		// A month-old cookie pointing at a cart that has been cleaned up: the first
		// add must still work rather than 404 in the shopper's face.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/expired", body: cartEnvelope({ id: "expired" }) },
			{
				match: "POST /v2/cart/expired/items",
				status: 404,
				body: { message: "gone" },
			},
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ id: "cart-new" }),
			},
			{
				match: "POST /v2/cart/cart-new/items",
				status: 201,
				body: cartEnvelope({ id: "cart-new", itemCount: 1 }),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "expired");

		const cart = await shopkit.cart.add({ productId: "prod_1" });

		expect(cart.id).toBe("cart-new");
		expect(await storage.get("qb_cart_id")).toBe("cart-new");
	});

	it("does not loop forever when the replacement cart also fails", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/expired", body: cartEnvelope({ id: "expired" }) },
			{ match: "POST /v2/cart/expired/items", status: 404, body: {} },
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ id: "cart-new" }),
			},
			{
				match: "POST /v2/cart/cart-new/items",
				status: 404,
				body: { message: "gone again" },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "expired");

		await expect(shopkit.cart.add({ productId: "prod_1" })).rejects.toThrow(
			/gone again/,
		);
	});
});

describe("cart mutations", () => {
	it("updates a line by its cart-item id", async () => {
		const fake = createFakeFetch([
			{
				match: "PATCH /v2/cart/cart-1/items/item-9",
				body: cartEnvelope({ itemCount: 3 }),
			},
		]);
		const { shopkit } = client(fake.fetch);

		const cart = await shopkit.cart.updateItem("cart-1", "item-9", 3);

		expect(cart.itemCount).toBe(3);
		expect(fake.calls[0]?.body).toEqual({ quantity: 3 });
	});

	it("removes a line", async () => {
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-1/items/item-9", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);
		await expect(
			shopkit.cart.removeItem("cart-1", "item-9"),
		).resolves.toBeTruthy();
	});

	it("forgets the cart it just deleted", async () => {
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				body: { message: "ok", statusCode: 200 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");

		await shopkit.cart.delete("cart-1");

		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("keeps a different remembered cart when deleting another one", async () => {
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/other",
				body: { message: "ok", statusCode: 200 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");

		await shopkit.cart.delete("other");

		expect(await storage.get("qb_cart_id")).toBe("cart-1");
	});
});

describe("the remembered store id", () => {
	// `Cart.storeId` is the shop's NUMERIC id — the value the hosted checkout URL
	// is built from, and the only place the storefront API states it. Every cart
	// that passes through the resource leaves it behind for `checkout.hostedUrl()`.

	it("is remembered when a cart is created", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit, storage } = client(fake.fetch);

		await shopkit.cart.ensure();

		expect(await storage.get("qb_store_id")).toBe("42");
	});

	it("is remembered from a plain read, even of a cart that is not the remembered one", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/cart/given",
				body: cartEnvelope({ id: "given", storeId: 101928 }),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);

		await shopkit.cart.get("given");

		expect(await storage.get("qb_store_id")).toBe("101928");
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("is refreshed by every mutation", async () => {
		const fake = createFakeFetch([
			{
				match: "PATCH /v2/cart/cart-1/items/item-9",
				body: cartEnvelope({ storeId: 7 }),
			},
			{
				match: "DELETE /v2/cart/cart-1/items/item-9",
				body: cartEnvelope({ storeId: 8 }),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);

		await shopkit.cart.updateItem("cart-1", "item-9", 3);
		expect(await storage.get("qb_store_id")).toBe("7");

		await shopkit.cart.removeItem("cart-1", "item-9");
		expect(await storage.get("qb_store_id")).toBe("8");
	});

	it("is written to storage once, not on every read", async () => {
		// A server request that merely reads the cart must not emit a Set-Cookie
		// for a value the cookie jar already holds.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const memory = createMemoryStorage();
		const set = vi.fn(memory.set);
		const storage: StorageAdapter = { ...memory, set };
		const { shopkit } = client(fake.fetch, storage);

		await shopkit.cart.get("cart-1");
		await shopkit.cart.get("cart-1");

		const storeWrites = set.mock.calls.filter(([key]) => key === "qb_store_id");
		expect(storeWrites).toHaveLength(1);
	});

	it("survives a storage that cannot be written — the cart read still succeeds", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const memory = createMemoryStorage();
		const storage: StorageAdapter = {
			...memory,
			set: () => {
				throw new Error("cookies are read-only here");
			},
		};
		const { shopkit } = client(fake.fetch, storage);

		const cart = await shopkit.cart.get("cart-1");

		expect(cart?.id).toBe("cart-1");
		// …and the id is still known in memory for the rest of the request.
		expect(shopkit.checkout.hostedUrl("sess-1")).toContain("/checkout/42/");
	});

	it("is kept when the cart it came with is deleted", async () => {
		// A constant of the shop, not of the cart: the publishable key pins
		// storage to one shop, so the value cannot go stale, and a thank-you
		// page keys its purchase event on it after the cart is gone.
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/cart-1",
				body: { message: "ok", statusCode: 200 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_store_id", "42");

		await shopkit.cart.delete("cart-1");

		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(await storage.get("qb_store_id")).toBe("42");
	});

	it("is kept when a different cart is deleted", async () => {
		const fake = createFakeFetch([
			{
				match: "DELETE /v2/cart/other",
				body: { message: "ok", statusCode: 200 },
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_store_id", "42");

		await shopkit.cart.delete("other");

		expect(await storage.get("qb_store_id")).toBe("42");
	});

	it("is kept when the remembered cart turns out to be gone", async () => {
		// The thank-you page case: the platform dropped the cart when the order
		// was created, and the header badge is the first to notice.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/stale", status: 404, body: {} },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "stale");
		await storage.set("qb_store_id", "42");

		await shopkit.cart.current();

		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(await storage.get("qb_store_id")).toBe("42");
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");
	});

	it("is replaced, not lost, when add() recovers from a dropped cart", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/expired", body: cartEnvelope({ id: "expired" }) },
			{ match: "POST /v2/cart/expired/items", status: 404, body: {} },
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ id: "cart-new" }),
			},
			{
				match: "POST /v2/cart/cart-new/items",
				status: 201,
				body: cartEnvelope({ id: "cart-new", itemCount: 1 }),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "expired");

		await shopkit.cart.add({ productId: "prod_1" });

		expect(await storage.get("qb_store_id")).toBe("42");
	});
});

describe("CartStore.onMutation", () => {
	const FULL_CART = cartEnvelope({ items: [cartLine()], itemCount: 1 });

	/** A store showing a cart with one line, and remembering it. */
	async function storeWithCart(fetchImpl: typeof globalThis.fetch) {
		const { shopkit, storage } = client(fetchImpl);
		await storage.set("qb_cart_id", "cart-1");
		const store = new CartStore(shopkit, FULL_CART.data as never);
		const mockListener = vi.fn<(event: CartMutationEvent) => void>();
		store.onMutation(mockListener);
		return { store, mockListener };
	}

	it("fires add with no cart before and the server's cart after", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);
		const mockListener = vi.fn<(event: CartMutationEvent) => void>();
		store.onMutation(mockListener);

		const actual = await store.add({ productId: "prod_27", variantId: 10 });

		expect(mockListener).toHaveBeenCalledTimes(1);
		expect(mockListener).toHaveBeenCalledWith({
			type: "add",
			before: null,
			after: actual,
		});
		expect(actual?.itemCount).toBe(1);
	});

	it("fires update with the cart before and after", async () => {
		const fake = createFakeFetch([
			{
				match: "PATCH /v2/cart/cart-1/items/line-1",
				body: cartEnvelope({
					items: [cartLine({ quantity: 3 })],
					itemCount: 3,
				}),
			},
		]);
		const { store, mockListener } = await storeWithCart(fake.fetch);

		const actual = await store.updateItem("line-1", 3);

		expect(mockListener).toHaveBeenCalledTimes(1);
		expect(mockListener).toHaveBeenCalledWith({
			type: "update",
			before: FULL_CART.data,
			after: actual,
		});
		expect(actual?.itemCount).toBe(3);
	});

	it("fires remove, including for an update to quantity zero", async () => {
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-1/items/line-1", body: cartEnvelope() },
			{ match: "DELETE /v2/cart/cart-1/items/line-1", body: cartEnvelope() },
		]);
		const { store, mockListener } = await storeWithCart(fake.fetch);

		await store.removeItem("line-1");
		await store.updateItem("line-1", 0);

		expect(mockListener.mock.calls.map(([event]) => event.type)).toEqual([
			"remove",
			"remove",
		]);
		expect(mockListener.mock.calls[0]?.[0].before).toEqual(FULL_CART.data);
		expect(mockListener.mock.calls[0]?.[0].after?.itemCount).toBe(0);
	});

	it("fires clear with no cart after", async () => {
		const fake = createFakeFetch([
			{ match: "DELETE /v2/cart/cart-1", status: 204, text: "" },
		]);
		const { store, mockListener } = await storeWithCart(fake.fetch);

		await store.clear();

		expect(mockListener).toHaveBeenCalledTimes(1);
		expect(mockListener).toHaveBeenCalledWith({
			type: "clear",
			before: FULL_CART.data,
			after: null,
		});
	});

	it("does not fire clear when there was nothing to clear", async () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		const store = new CartStore(shopkit);
		const mockListener = vi.fn();
		store.onMutation(mockListener);

		await store.clear();

		expect(mockListener).not.toHaveBeenCalled();
	});

	it("fires buy-now with the cart the add produced", async () => {
		const routes: FakeRoute[] = [
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
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
				},
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		];
		const { shopkit } = client(createFakeFetch(routes).fetch);
		const store = new CartStore(shopkit);
		const mockListener = vi.fn<(event: CartMutationEvent) => void>();
		store.onMutation(mockListener);

		const actual = await store.buyNow(
			{ productId: "prod_27", variantId: 10 },
			{ successUrl: "https://myshop.test/order" },
		);

		expect(mockListener).toHaveBeenCalledTimes(1);
		expect(mockListener).toHaveBeenCalledWith({
			type: "buy-now",
			before: null,
			after: actual.cart,
		});
	});

	it("does not fire for load, refresh or hydrate", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		const store = new CartStore(shopkit);
		const mockListener = vi.fn();
		store.onMutation(mockListener);

		await store.load();
		await store.refresh();
		store.hydrate(FULL_CART.data as never);

		expect(fake.calls).toHaveLength(2);
		expect(store.getSnapshot().itemCount).toBe(1);
		expect(mockListener).not.toHaveBeenCalled();
	});

	it("does not fire for a mutation that failed", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 500,
				body: { message: "boom", statusCode: 500 },
			},
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);
		const mockListener = vi.fn();
		store.onMutation(mockListener);

		const actual = await store.add({ productId: "prod_27" });

		expect(actual).toBeNull();
		expect(store.getSnapshot().status).toBe("error");
		expect(mockListener).not.toHaveBeenCalled();
	});

	it("survives a listener that throws, and still tells the others", async () => {
		const mockError = vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);
		store.onMutation(() => {
			throw new Error("listener exploded");
		});
		const mockListener = vi.fn();
		store.onMutation(mockListener);

		try {
			const actual = await store.add({ productId: "prod_27", variantId: 10 });

			expect(actual?.itemCount).toBe(1);
			expect(store.getSnapshot().status).toBe("ready");
			expect(store.getSnapshot().revision).toBe(1);
			expect(mockListener).toHaveBeenCalledTimes(1);
			expect(mockError).toHaveBeenCalledWith(
				"shopkit: a cart mutation listener threw",
				expect.any(Error),
			);
		} finally {
			mockError.mockRestore();
		}
	});

	it("stops after unsubscribing", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);
		const mockListener = vi.fn();
		const unsubscribe = store.onMutation(mockListener);

		unsubscribe();
		await store.add({ productId: "prod_27", variantId: 10 });

		expect(mockListener).not.toHaveBeenCalled();
	});
});
