import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { resolveConfig, type ShopkitConfig } from "../src/sdk/config.js";
import { ShopkitApiError, ShopkitConfigError } from "../src/sdk/errors.js";
import {
	isStorefrontId,
	isStorefrontSurface,
	STOREFRONT_SURFACES,
	type StorefrontRefusal,
	type StorefrontSurface,
	storefrontRefusal,
} from "../src/sdk/storefront.js";
import type { Cart } from "../src/sdk/types/cart.js";
import type { CreateSessionInput } from "../src/sdk/types/checkout.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

const SF_ID = "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD";
const OTHER_SF_ID = "sf_01HZY7Q3N9M2K4P6R8T0V1W3X5";

const SESSION = {
	sessionId: "sess-1",
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	fields: {},
	data: {},
};

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Partial<ShopkitConfig> = {},
) {
	const storage = createMemoryStorage();
	return {
		shopkit: createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fetchImpl,
			storage,
			maxRetries: 0,
			...overrides,
		}),
		storage,
	};
}

/** A client bound to `SF_ID` at the config level. */
function boundClient(
	fetchImpl: typeof globalThis.fetch,
	surface?: StorefrontSurface,
) {
	return client(fetchImpl, { storefront: { id: SF_ID, surface } });
}

describe("ShopkitConfig.storefront", () => {
	it("resolves the binding with surface defaulted to shopkit", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			storefront: { id: SF_ID },
		});

		expect(actual.storefront).toEqual({ id: SF_ID, surface: "shopkit" });
	});

	it("keeps an explicit surface", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			storefront: { id: SF_ID, surface: "embed" },
		});

		expect(actual.storefront?.surface).toBe("embed");
	});

	it("is null on an ordinary client, with the plain qb prefix", () => {
		const actual = resolveConfig({ publishableKey: TEST_KEY });

		expect(actual.storefront).toBeNull();
		expect(actual.storageKeyPrefix).toBe("qb");
	});

	it("accepts a lower-cased id — Crockford base32 is case-insensitive", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			storefront: { id: SF_ID.toLowerCase() },
		});

		expect(actual.storefront?.id).toBe(SF_ID.toLowerCase());
	});

	it("rejects a malformed id by name", () => {
		for (const id of [
			"sf_short",
			"sfp_01JBQ8ZK4M7XW9YR2TCVN3H5PD", // a storefront PRODUCT id
			"01JBQ8ZK4M7XW9YR2TCVN3H5PD", // prefix missing
			"sf_01JBQ8ZK4M7XW9YR2TCVN3H5PI", // I is not in the alphabet
			"",
		]) {
			expect(() =>
				resolveConfig({ publishableKey: TEST_KEY, storefront: { id } }),
			).toThrow(ShopkitConfigError);
			expect(() =>
				resolveConfig({ publishableKey: TEST_KEY, storefront: { id } }),
			).toThrow(/storefront\.id/);
		}
	});

	it("rejects a surface outside the vocabulary and names the options", () => {
		const bad = { id: SF_ID, surface: "widget" as StorefrontSurface };

		expect(() =>
			resolveConfig({ publishableKey: TEST_KEY, storefront: bad }),
		).toThrow(ShopkitConfigError);
		expect(() =>
			resolveConfig({ publishableKey: TEST_KEY, storefront: bad }),
		).toThrow(/"hosted", "link", "embed", "shopkit", "agentic"/);
	});

	it("is exposed on the client, and survives cloning with withStorage()", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit } = boundClient(fake.fetch, "link");

		expect(shopkit.storefront).toEqual({ id: SF_ID, surface: "link" });

		const cloneStorage = createMemoryStorage();
		const cloned = shopkit.withStorage(cloneStorage);
		expect(cloned.storefront).toEqual({ id: SF_ID, surface: "link" });

		// The clone keeps the bound storage prefix too, so its remembered cart
		// stays apart from the shop's plain one.
		await cloned.cart.ensure();
		expect(
			await cloneStorage.get("qb_sf_01jbq8zk4m7xw9yr2tcvn3h5pd_cart_id"),
		).toBe("cart-1");
		expect(await cloneStorage.get("qb_cart_id")).toBeNull();
	});
	it("leaves `storefront` off an unbound client", () => {
		const { shopkit } = client(createFakeFetch([]).fetch);
		expect(shopkit.storefront).toBeNull();
	});
});

describe("storage prefix on a bound client", () => {
	it("defaults to qb_<id lower-cased>, so a campaign cart never shares the shop's cookie", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit, storage } = boundClient(fake.fetch);

		expect(
			resolveConfig({ publishableKey: TEST_KEY, storefront: { id: SF_ID } })
				.storageKeyPrefix,
		).toBe("qb_sf_01jbq8zk4m7xw9yr2tcvn3h5pd");

		await shopkit.cart.ensure();

		expect(await storage.get("qb_sf_01jbq8zk4m7xw9yr2tcvn3h5pd_cart_id")).toBe(
			"cart-1",
		);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("does not see the shop's ordinary remembered cart", async () => {
		const fake = createFakeFetch([]);
		const { shopkit, storage } = boundClient(fake.fetch);
		await storage.set("qb_cart_id", "shop-cart");

		await expect(shopkit.cart.current()).resolves.toBeNull();
		expect(fake.calls).toHaveLength(0);
	});

	it("yields to an explicit storageKeyPrefix", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			storefront: { id: SF_ID },
			storageKeyPrefix: "mine",
		});

		expect(actual.storageKeyPrefix).toBe("mine");
	});
});

describe("cart.create", () => {
	it("posts no body on an unbound client — byte-identical to before", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.create();

		expect(fake.calls[0]?.body).toBeNull();
	});

	it("binds the cart to the client's campaign storefront", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ storefrontId: SF_ID, surface: "shopkit" }),
			},
		]);
		const { shopkit } = boundClient(fake.fetch);

		const cart = await shopkit.cart.create();

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "shopkit",
		});
		expect(cart.storefrontId).toBe(SF_ID);
		expect(cart.surface).toBe("shopkit");
	});

	it("takes a per-call binding on an unbound client", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.create({ storefrontId: SF_ID, surface: "agentic" });

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "agentic",
		});
	});

	it("lets a per-call storefrontId beat the client's, field by field", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit } = boundClient(fake.fetch, "embed");

		await shopkit.cart.create({ storefrontId: OTHER_SF_ID });

		// The id is the call's; the surface, not overridden, is still the client's.
		expect(fake.calls[0]?.body).toEqual({
			storefrontId: OTHER_SF_ID,
			surface: "embed",
		});
	});

	it("ensure() and add() create bound carts on a bound client", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		const { shopkit } = boundClient(fake.fetch);

		await shopkit.cart.add({ productId: "prod_1" });

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "shopkit",
		});
		// The add itself is unchanged: the binding lives on the cart, not the line.
		expect(fake.calls[1]?.body).toEqual({ productId: "prod_1", quantity: 1 });
	});

	it("add() and ensure() refuse a per-call campaign on an unbound client", async () => {
		// They reuse the remembered cart. Creating a campaign cart here would
		// persist it under the shop's plain qb_cart_id for thirty days.
		const fake = createFakeFetch([]);
		const { shopkit, storage } = client(fake.fetch);

		const add = shopkit.cart.add(
			{ productId: "prod_1" },
			{ storefrontId: SF_ID },
		);
		await expect(add).rejects.toThrow(ShopkitConfigError);
		await expect(add).rejects.toThrow(/cart\.add\(\)/);
		await expect(add).rejects.toThrow(/createShopkitClient\(\{ storefront/);

		const ensure = shopkit.cart.ensure({ storefrontId: SF_ID });
		await expect(ensure).rejects.toThrow(/cart\.ensure\(\)/);

		expect(fake.calls).toHaveLength(0);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("add() refuses a per-call campaign that differs from the client's, but accepts its own", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		const { shopkit } = boundClient(fake.fetch);

		await expect(
			shopkit.cart.add({ productId: "prod_1" }, { storefrontId: OTHER_SF_ID }),
		).rejects.toThrow(ShopkitConfigError);
		expect(fake.calls).toHaveLength(0);

		await shopkit.cart.add({ productId: "prod_1" }, { storefrontId: SF_ID });
		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "shopkit",
		});
	});
	it("rejects a malformed per-call id before any request goes out", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.cart.create({ storefrontId: "sf_nope" }),
		).rejects.toThrow(ShopkitConfigError);
		expect(fake.calls).toHaveLength(0);
	});

	it("drops a surface given without any storefront — a placement needs a campaign", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.cart.create({ surface: "link" });

		expect(fake.calls[0]?.body).toBeNull();
	});

	it("types the binding as optional-null, for a platform older than the field", () => {
		// Compile-time: both spellings of "no binding" are assignable.
		const legacy: Cart = cartEnvelope().data as Cart;
		const modern: Cart = { ...legacy, storefrontId: null, surface: null };
		expect(legacy.storefrontId ?? null).toBeNull();
		expect(modern.surface).toBeNull();
	});
});

describe("checkout.createSession", () => {
	it("sends neither field on an unbound client", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		expect(fake.calls[0]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});
		expect(fake.calls[0]?.body).not.toHaveProperty("storefrontId");
		expect(fake.calls[0]?.body).not.toHaveProperty("surface");
	});

	it("sends both fields from the client's binding", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = boundClient(fake.fetch, "hosted");

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		expect(fake.calls[0]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
			surface: "hosted",
		});
	});

	it("lets the per-call pair beat the client's", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = boundClient(fake.fetch, "hosted");

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: OTHER_SF_ID,
			surface: "agentic",
		});

		expect(fake.calls[0]?.body).toMatchObject({
			storefrontId: OTHER_SF_ID,
			surface: "agentic",
		});
	});

	it("defaults the surface to shopkit for a per-call id on an unbound client", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
		});

		expect(fake.calls[0]?.body).toMatchObject({
			storefrontId: SF_ID,
			surface: "shopkit",
		});
	});

	it("accepts the new fields on the input type", () => {
		const input: CreateSessionInput = {
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
			surface: "link",
		};
		expect(input.surface).toBe("link");
	});
});

describe("checkout.start / handoff", () => {
	const handoff = {
		...SESSION,
		checkout: "v2",
		hostedUrl: "https://platform-checkout.test/checkout/42/sess-1",
	};

	it("sends neither field on an unbound client", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.start({ successUrl: "https://myshop.test/order" });

		expect(fake.calls[0]?.body).toBeNull();
		expect(fake.calls[1]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});
	});

	it("binds the cart it creates AND the handoff to the client's campaign storefront", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit } = boundClient(fake.fetch);

		await shopkit.checkout.start({ successUrl: "https://myshop.test/order" });

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "shopkit",
		});
		expect(fake.calls[1]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
			surface: "shopkit",
		});
	});

	it("takes a per-call binding on an unbound client only for a cart the caller names", async () => {
		// The stateless pattern: create a cart for the campaign, then check THAT
		// cart out. Both requests carry the pair; nothing is remembered under
		// the shop's plain prefix.
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit, storage } = client(fake.fetch);

		const cart = await shopkit.cart.create({
			storefrontId: SF_ID,
			surface: "embed",
		});
		await shopkit.checkout.start({
			cartId: cart.id,
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
			surface: "embed",
		});

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "embed",
		});
		expect(fake.calls[2]?.body).toMatchObject({
			storefrontId: SF_ID,
			surface: "embed",
		});
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("refuses a per-call campaign on an unbound client's remembered cart, before any request", async () => {
		// Without a cartId, start() reuses the remembered cart. On an unbound
		// client that would create a campaign-priced cart and remember it as the
		// shop's ordinary one for a month — so it is refused by name instead.
		const fake = createFakeFetch([]);
		const { shopkit, storage } = client(fake.fetch);

		const attempt = shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID,
		});

		await expect(attempt).rejects.toThrow(ShopkitConfigError);
		await expect(attempt).rejects.toThrow(/not bound to a campaign storefront/);
		await expect(attempt).rejects.toThrow(/cart\.create\(\{ storefrontId \}\)/);
		expect(fake.calls).toHaveLength(0);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("refuses a DIFFERENT per-call campaign on a bound client's remembered cart", async () => {
		// The remembered cart was created for the client's campaign; the platform
		// would answer storefront_mismatch. Refused locally, with no request.
		const fake = createFakeFetch([]);
		const { shopkit } = boundClient(fake.fetch);

		const attempt = shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			storefrontId: OTHER_SF_ID,
		});

		await expect(attempt).rejects.toThrow(ShopkitConfigError);
		await expect(attempt).rejects.toThrow(/checkout\.start\(\)/);
		await expect(attempt).rejects.toThrow(new RegExp(SF_ID));
		expect(fake.calls).toHaveLength(0);
	});

	it("accepts a per-call id that restates the client's own, in either case", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit } = boundClient(fake.fetch);

		await shopkit.checkout.start({
			successUrl: "https://myshop.test/order",
			storefrontId: SF_ID.toLowerCase(),
			surface: "link",
		});

		// The client's spelling goes on the wire; the per-call surface is honoured.
		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "link",
		});
		expect(fake.calls[1]?.body).toMatchObject({
			storefrontId: SF_ID.toLowerCase(),
			surface: "link",
		});
	});
	it("per-call beats client-level on the handoff", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit } = boundClient(fake.fetch, "hosted");

		await shopkit.checkout.start({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			storefrontId: OTHER_SF_ID,
		});

		expect(fake.calls[1]?.body).toMatchObject({
			storefrontId: OTHER_SF_ID,
			surface: "hosted",
		});
	});

	it("buyNow() on a bound client binds the cart add() creates and the handoff alike", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ itemCount: 1 }) },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff },
		]);
		const { shopkit } = boundClient(fake.fetch, "link");

		await shopkit.checkout.buyNow(
			{ productId: "prod_1" },
			{ successUrl: "https://myshop.test/order" },
		);

		expect(fake.calls[0]?.body).toEqual({
			storefrontId: SF_ID,
			surface: "link",
		});
		expect(fake.calls[3]?.body).toMatchObject({
			storefrontId: SF_ID,
			surface: "link",
		});
	});

	it("buyNow() refuses a per-call campaign the client is not bound to, before adding anything", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);

		const attempt = shopkit.checkout.buyNow(
			{ productId: "prod_1" },
			{ successUrl: "https://myshop.test/order", storefrontId: SF_ID },
		);

		await expect(attempt).rejects.toThrow(ShopkitConfigError);
		await expect(attempt).rejects.toThrow(/checkout\.buyNow\(\)/);
		expect(fake.calls).toHaveLength(0);
	});
	it("rejects a malformed per-call id before touching the cart", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.start({
				successUrl: "https://myshop.test/order",
				storefrontId: "sf_not-an-id",
			}),
		).rejects.toThrow(/storefrontId/);
		expect(fake.calls).toHaveLength(0);
	});
});

describe("storefrontRefusal", () => {
	async function refusalFrom(status: number, body: unknown) {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status, body },
		]);
		const { shopkit } = boundClient(fake.fetch);
		return shopkit.checkout
			.start({ cartId: "cart-1", successUrl: "https://myshop.test/order" })
			.catch((error: unknown) => error);
	}

	it("decodes a campaign that is not live, as api-core shapes it", async () => {
		const error = await refusalFrom(409, {
			message: "Storefront is not open for purchases",
			details: {
				reason: "storefront_not_live",
				storefront_id: SF_ID,
				effective_state: "paused",
			},
		});

		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(storefrontRefusal(error)).toEqual({
			reason: "storefront_not_live",
			storefrontId: SF_ID,
			effectiveState: "paused",
		});
	});

	it("decodes a per-order quantity limit", async () => {
		const error = await refusalFrom(409, {
			message:
				"This campaign limits how many of this product one order can contain",
			details: {
				reason: "storefront_quantity_limit",
				storefront_id: SF_ID,
				product_id: "prod_27",
				variant_id: 10,
				limit_type: "per_order",
				max_quantity: 2,
			},
		});

		expect(storefrontRefusal(error)).toEqual({
			reason: "storefront_quantity_limit",
			storefrontId: SF_ID,
			limitType: "per_order",
			productId: "prod_27",
			variantId: 10,
			maxQuantity: 2,
		});
	});

	it("decodes a spent pool, with a zero remaining quantity kept as 0", async () => {
		const error = await refusalFrom(409, {
			message: "This campaign has sold out of one of the products in your cart",
			details: {
				reason: "storefront_quantity_limit",
				storefront_id: SF_ID,
				product_id: "prod_27",
				variant_id: null,
				limit_type: "pool",
				max_quantity: 0,
			},
		});

		const refusal = storefrontRefusal(error);
		expect(refusal?.reason).toBe("storefront_quantity_limit");
		if (refusal?.reason !== "storefront_quantity_limit") throw new Error();
		expect(refusal.limitType).toBe("pool");
		expect(refusal.maxQuantity).toBe(0);
		expect(refusal.variantId).toBeNull();
	});

	it("tolerates missing members rather than throwing", async () => {
		const error = await refusalFrom(409, {
			message: "conflict",
			details: { reason: "storefront_quantity_limit" },
		});

		expect(storefrontRefusal(error)).toEqual({
			reason: "storefront_quantity_limit",
			storefrontId: null,
			limitType: "per_order",
			productId: null,
			variantId: null,
			maxQuantity: null,
		});
	});

	it("reads details out of the raw body when the normalized field lacks a reason", () => {
		const error = new ShopkitApiError("conflict", 409, {
			message: "conflict",
			details: { reason: "storefront_not_live", effective_state: "expired" },
		});

		expect(storefrontRefusal(error)?.reason).toBe("storefront_not_live");
	});

	it("is null for an ordinary 409 — an out-of-stock line is not a campaign refusal", async () => {
		const error = await refusalFrom(409, {
			message: "Some cart items cannot be fulfilled",
			details: { items: [{ productId: "prod_1" }] },
		});

		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(storefrontRefusal(error)).toBeNull();
	});

	it("decodes storefront_mismatch, which travels on a 400", async () => {
		const error = await refusalFrom(400, {
			message: "This cart was started from a different storefront",
			details: {
				reason: "storefront_mismatch",
				storefront_id: OTHER_SF_ID,
				cart_storefront_id: SF_ID,
			},
		});

		expect(storefrontRefusal(error)).toEqual({
			reason: "storefront_mismatch",
			storefrontId: OTHER_SF_ID,
			cartStorefrontId: SF_ID,
		});
	});

	it("matches on the reason, not the status, and is null for an unknown reason", async () => {
		const unknownReason = await refusalFrom(409, {
			message: "conflict",
			details: { reason: "something_else", storefront_id: SF_ID },
		});
		expect(storefrontRefusal(unknownReason)).toBeNull();

		// A known reason on an unexpected status still decodes: the decoder does
		// not have to be told which status each reason travels on.
		const oddStatus = await refusalFrom(422, {
			message: "odd",
			details: { reason: "storefront_not_live", effective_state: "paused" },
		});
		expect(storefrontRefusal(oddStatus)?.reason).toBe("storefront_not_live");
	});

	it("is null when details is an array or the body is text", async () => {
		// The gateway's validation errors arrive as `errors: [...]`, which the
		// transport surfaces as `details`; a proxy's HTML page arrives as text.
		const arrayDetails = await refusalFrom(400, {
			message: "validation failed",
			errors: [{ path: "storefrontId", message: "must match pattern" }],
		});
		expect(arrayDetails).toBeInstanceOf(ShopkitApiError);
		expect((arrayDetails as ShopkitApiError).details).toBeInstanceOf(Array);
		expect(storefrontRefusal(arrayDetails)).toBeNull();

		const textBody = new ShopkitApiError(
			"bad gateway",
			502,
			"<html>nope</html>",
		);
		expect(storefrontRefusal(textBody)).toBeNull();

		const detailsArrayInBody = new ShopkitApiError("x", 409, {
			details: ["storefront_not_live"],
		});
		expect(storefrontRefusal(detailsArrayInBody)).toBeNull();
	});

	it("is null for non-API errors", () => {
		expect(storefrontRefusal(new Error("boom"))).toBeNull();
		expect(storefrontRefusal(null)).toBeNull();
		expect(storefrontRefusal(undefined)).toBeNull();
		expect(storefrontRefusal("storefront_not_live")).toBeNull();
		expect(
			storefrontRefusal({ details: { reason: "storefront_not_live" } }),
		).toBeNull();
	});
	it("narrows by reason at the type level", () => {
		const refusal: StorefrontRefusal = {
			reason: "storefront_not_live",
			storefrontId: SF_ID,
			effectiveState: "coming_soon",
		};
		if (refusal.reason === "storefront_not_live") {
			expect(refusal.effectiveState).toBe("coming_soon");
		}
	});
});

describe("vocabulary", () => {
	it("exports the five surfaces in the platform's order", () => {
		expect(STOREFRONT_SURFACES).toEqual([
			"hosted",
			"link",
			"embed",
			"shopkit",
			"agentic",
		]);
		expect(isStorefrontSurface("shopkit")).toBe(true);
		expect(isStorefrontSurface("widget")).toBe(false);
	});

	it("recognises a campaign storefront id in either case and nothing else", () => {
		expect(isStorefrontId(SF_ID)).toBe(true);
		expect(isStorefrontId(SF_ID.toLowerCase())).toBe(true);
		expect(isStorefrontId("sfp_01JBQ8ZK4M7XW9YR2TCVN3H5PD")).toBe(false);
		expect(isStorefrontId(42)).toBe(false);
	});
});
