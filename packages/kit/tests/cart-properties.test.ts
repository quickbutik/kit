import { describe, expect, it } from "vitest";
import { cartLineDiff } from "../src/analytics/events.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { linePropertiesKey } from "../src/sdk/line-properties.js";
import type {
	Cart,
	CartItem,
	CartItemProperty,
} from "../src/sdk/types/cart.js";
import { CartStore } from "../src/state/cart-store.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

/**
 * Product fields ("produktfält"): the shopper's input travels with the add,
 * and comes back resolved on the cart line. The same variant with different
 * input is a separate line server-side, and nothing in the kit may fold the
 * two back into one.
 */

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

const NAME_ANNA: CartItemProperty = {
	propertyId: 12,
	value: "Anna",
	title: "Namn",
	type: "shorttext",
	price: 5000,
};
const NAME_BO: CartItemProperty = { ...NAME_ANNA, value: "Bo" };
const GIFT_WRAP: CartItemProperty = {
	propertyId: 13,
	value: "1",
	title: "Presentinslagning",
	type: "checkbox",
	price: 0,
};

/** A cart with the given lines, in the shape the API returns. */
function cart(items: CartItem[]): Cart {
	return cartEnvelope({
		items,
		itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
	}).data as unknown as Cart;
}

/** Create, then add — `cart.add()` on a fresh visitor. */
function addRoutes(after: CartItem[]): FakeRoute[] {
	return [
		{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		{
			match: "POST /v2/cart/cart-1/items",
			status: 201,
			body: cartEnvelope({
				items: after,
				itemCount: after.reduce((n, line) => n + line.quantity, 0),
			}),
		},
	];
}

describe("cart.add with properties", () => {
	it("sends the product-field input with the add", async () => {
		const fake = createFakeFetch(addRoutes([cartLine()]));
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.add({
			productId: "prod_27",
			variantId: 10,
			quantity: 2,
			properties: [
				{ propertyId: 12, value: "Anna" },
				{ propertyId: 13, value: "1" },
			],
		});

		expect(fake.calls[1]?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 2,
			properties: [
				{ propertyId: 12, value: "Anna" },
				{ propertyId: 13, value: "1" },
			],
		});
	});

	it("sends only propertyId and value, whatever else the caller's objects carry", async () => {
		// A storefront passing a resolved CartItemProperty (or its own form
		// state) straight back must not leak title/type/price into the request.
		const fake = createFakeFetch(addRoutes([cartLine()]));
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.add({
			productId: 27,
			properties: [NAME_ANNA],
		});

		expect((fake.calls[1]?.body as { properties: unknown }).properties).toEqual(
			[{ propertyId: 12, value: "Anna" }],
		);
	});

	it("leaves the body unchanged when there is no input", async () => {
		const fake = createFakeFetch([
			...addRoutes([cartLine()]),
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope(),
			},
		]);
		const { shopkit, storage } = client(fake.fetch);

		await shopkit.cart.add({ productId: 7 });
		await storage.set("qb_cart_id", "cart-1");
		await shopkit.cart.addItem("cart-1", { productId: 7, properties: [] });

		expect(fake.calls[1]?.body).toEqual({ productId: 7, quantity: 1 });
		expect(fake.calls[2]?.body).toEqual({ productId: 7, quantity: 1 });
	});

	it("types and returns the resolved properties on the cart line", async () => {
		const fake = createFakeFetch(
			addRoutes([cartLine({ properties: [NAME_ANNA, GIFT_WRAP] })]),
		);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.cart.add({
			productId: 27,
			variantId: 10,
			properties: [
				{ propertyId: 12, value: "Anna" },
				{ propertyId: 13, value: "1" },
			],
		});

		expect(result.items[0]?.properties).toEqual([NAME_ANNA, GIFT_WRAP]);
	});

	it("keeps a stale field (title and type null) as the server sent it", async () => {
		const stale: CartItemProperty = {
			propertyId: 99,
			value: "Anna",
			title: null,
			type: null,
			price: 0,
		};
		const fake = createFakeFetch(
			addRoutes([cartLine({ properties: [stale] })]),
		);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.cart.add({ productId: 27 });

		expect(result.items[0]?.properties).toEqual([stale]);
	});

	it("surfaces a refused add (a missing required field) as an API error", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 400,
				body: {
					statusCode: 400,
					message: "Required product field is missing",
					details: { productId: 27, propertyId: 14 },
				},
			},
		]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.cart.add({
				productId: 27,
				properties: [{ propertyId: 12, value: "Anna" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("CartStore.add with properties", () => {
	it("sends the input and keeps two lines of the same variant apart", async () => {
		// The store holds the server's cart as it is, with no local merge, so a
		// second line for the same variant with other input stays a second line.
		const first = cartLine({ id: "line-1", properties: [NAME_ANNA] });
		const second = cartLine({ id: "line-2", properties: [NAME_BO] });
		const fake = createFakeFetch([
			...addRoutes([first]),
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ items: [first] }) },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [first, second], itemCount: 2 }),
			},
		]);
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await store.add({
			productId: 27,
			variantId: 10,
			properties: [{ propertyId: 12, value: "Anna" }],
		});
		await store.add({
			productId: 27,
			variantId: 10,
			properties: [{ propertyId: 12, value: "Bo" }],
		});

		const adds = fake.calls.filter((c) => c.url.endsWith("/items"));
		expect(
			adds.map((c) => (c.body as { properties: unknown }).properties),
		).toEqual([
			[{ propertyId: 12, value: "Anna" }],
			[{ propertyId: 12, value: "Bo" }],
		]);
		const snapshot = store.getSnapshot();
		expect(snapshot.error).toBeNull();
		expect(snapshot.cart?.items.map((line) => line.id)).toEqual([
			"line-1",
			"line-2",
		]);
		expect(snapshot.itemCount).toBe(2);
	});

	it("reports the second line as an add to mutation listeners' diff", async () => {
		const first = cartLine({ id: "line-1", properties: [NAME_ANNA] });
		const second = cartLine({ id: "line-2", properties: [NAME_BO] });
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [first, second], itemCount: 2 }),
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ items: [first] }) },
		]);
		const { shopkit, storage } = client(fake.fetch);
		await storage.set("qb_cart_id", "cart-1");
		const store = new CartStore(shopkit, cart([first]));
		const diffs: ReturnType<typeof cartLineDiff>[] = [];
		store.onMutation(({ before, after }) =>
			diffs.push(cartLineDiff(before, after)),
		);

		await store.add({
			productId: 27,
			variantId: 10,
			properties: [{ propertyId: 12, value: "Bo" }],
		});

		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.added).toEqual([
			{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 },
		]);
		expect(diffs[0]?.removed).toEqual([]);
	});
});

describe("buyNow with properties", () => {
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
	const LINE = cartLine({ properties: [NAME_ANNA] });
	const FULL = cartEnvelope({ items: [LINE], itemCount: 1 });

	function routes(): FakeRoute[] {
		return [
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL },
			{ match: "GET /v2/cart/cart-1", body: FULL },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		];
	}

	it("checkout.buyNow() sends the input with its add", async () => {
		const fake = createFakeFetch(routes());
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.buyNow(
			{
				productId: "prod_27",
				variantId: 10,
				properties: [{ propertyId: 12, value: "Anna" }],
			},
			{ successUrl: "https://myshop.test/order" },
		);

		const add = fake.calls.find((c) => c.url.endsWith("/items"));
		expect(add?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 1,
			properties: [{ propertyId: 12, value: "Anna" }],
		});
		expect(result.cart.items[0]?.properties).toEqual([NAME_ANNA]);
	});

	it("CartStore.buyNow() sends the input and folds the line in", async () => {
		const fake = createFakeFetch(routes());
		const { shopkit } = client(fake.fetch);
		const store = new CartStore(shopkit);

		await store.buyNow(
			{
				productId: "prod_27",
				variantId: 10,
				properties: [{ propertyId: 12, value: "Anna" }],
			},
			{ successUrl: "https://myshop.test/order" },
		);

		const add = fake.calls.find((c) => c.url.endsWith("/items"));
		expect((add?.body as { properties: unknown }).properties).toEqual([
			{ propertyId: 12, value: "Anna" },
		]);
		expect(store.getSnapshot().cart?.items[0]?.properties).toEqual([NAME_ANNA]);
	});
});

describe("cartLineDiff with properties", () => {
	it("reports a second line of the same variant with other input as added", () => {
		const anna = cartLine({ id: "line-1", properties: [NAME_ANNA] });
		const bo = cartLine({ id: "line-2", properties: [NAME_BO] });

		const actual = cartLineDiff(cart([anna]), cart([anna, bo]));

		expect(actual.added).toEqual([
			{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 },
		]);
		expect(actual.removed).toEqual([]);
	});

	it("reports a line swapped for other input as one removed and one added", () => {
		const anna = cartLine({ id: "line-1", properties: [NAME_ANNA] });
		const bo = cartLine({ id: "line-2", properties: [NAME_BO] });

		const actual = cartLineDiff(cart([anna]), cart([bo]));

		expect(actual.added).toHaveLength(1);
		expect(actual.removed).toHaveLength(1);
	});

	it("still reads a line with and without input as different lines", () => {
		const plain = cartLine({ id: "line-1" });
		const named = cartLine({ id: "line-2", properties: [NAME_ANNA] });

		const actual = cartLineDiff(cart([plain]), cart([plain, named]));

		expect(actual.added).toEqual([
			{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 },
		]);
	});
});

describe("linePropertiesKey", () => {
	it("is empty for no input, so ordinary lines key as they always did", () => {
		expect(linePropertiesKey(undefined)).toBe("");
		expect(linePropertiesKey(null)).toBe("");
		expect(linePropertiesKey([])).toBe("");
	});

	it("ignores order, and the resolved fields beside the input", () => {
		expect(linePropertiesKey([GIFT_WRAP, NAME_ANNA])).toBe(
			linePropertiesKey([
				{ propertyId: 12, value: "Anna" },
				{ propertyId: 13, value: "1" },
			]),
		);
	});

	it("reads a numeric and a string id alike", () => {
		expect(linePropertiesKey([{ propertyId: "12", value: "Anna" }])).toBe(
			linePropertiesKey([{ propertyId: 12, value: "Anna" }]),
		);
	});

	it("cannot be forged by separators typed into a value", () => {
		expect(
			linePropertiesKey([
				{ propertyId: 1, value: 'a","2' },
				{ propertyId: 3, value: "b" },
			]),
		).not.toBe(
			linePropertiesKey([
				{ propertyId: 1, value: "a" },
				{ propertyId: 2, value: '","3","b' },
			]),
		);
	});
});

describe("stale session cart with properties", () => {
	const SESSION = {
		sessionId: "sess-1",
		cartId: "cart-1",
		successUrl: "https://myshop.test/order",
		cancelUrl: null,
		backUrl: null,
		language: null,
		origin: null,
		theme: "light",
	};

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

	const PATCH: FakeRoute = {
		match: "PATCH /v2/checkout/sessions/sess-1",
		body: {
			fields: {},
			data: {},
			invalidatedFields: [],
			resolvedData: [],
			isComplete: false,
		},
	};

	async function create(
		snapshotItems: Array<Record<string, unknown>>,
		liveItems: CartItem[],
	) {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: sessionWith(snapshotItems),
			},
			PATCH,
		]);
		const { shopkit } = client(fake.fetch);
		await shopkit.checkout.createSession(
			{ cartId: "cart-1", successUrl: "https://myshop.test/order" },
			{ cart: cart(liveItems) },
		);
		return fake.calls.length;
	}

	it("treats the same variant with other input as stale", async () => {
		const calls = await create(
			[
				{
					productId: "27",
					variantId: "10",
					quantity: 1,
					properties: [NAME_ANNA],
				},
			],
			[cartLine({ properties: [NAME_BO] })],
		);

		expect(calls).toBe(2);
	});

	it("does not patch when the input matches, in any order", async () => {
		const calls = await create(
			[
				{
					productId: "27",
					variantId: "10",
					quantity: 1,
					properties: [GIFT_WRAP, NAME_ANNA],
				},
			],
			[cartLine({ properties: [NAME_ANNA, GIFT_WRAP] })],
		);

		expect(calls).toBe(1);
	});
});
