import { describe, expect, it, vi } from "vitest";
import {
	createMemoryStorage,
	createRequestCookieStorage,
} from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { ShopkitConfig } from "../src/sdk/config.js";
import { describeCurrency, normalizeCurrency } from "../src/sdk/currency.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import type { Shop } from "../src/sdk/types/shop.js";
import { CartStore } from "../src/state/cart-store.js";
import {
	clearProductCache,
	getProductPromise,
} from "../src/state/product-cache.js";
import { getShopPromise } from "../src/state/shop-cache.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

const PRODUCT = { id: "prod_27", name: "Tee", slug: "tee", price: 9900 };
const PAGE = { data: [PRODUCT], has_more: false, next_cursor: null };

const SHOP: Shop = {
	name: "Shop",
	brand: { logo: null, color: { primary: null } },
	currency: "SEK",
	currencies: [
		{ code: "SEK", mode: "base", rate: 1 },
		{ code: "EUR", mode: "charge", rate: 0.0871 },
		{ code: "NOK", mode: "display", rate: 0.95 },
	],
};

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Partial<ShopkitConfig> = {},
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		...overrides,
	});
}

function sentCurrency(
	fake: ReturnType<typeof createFakeFetch>,
	index = 0,
): string | null {
	const call = fake.calls[index];
	if (!call) throw new Error(`no request at index ${index}`);
	return new URL(call.url).searchParams.get("currency");
}

describe("normalizeCurrency", () => {
	it("upper-cases and trims", () => {
		expect(normalizeCurrency(" eur ")).toBe("EUR");
	});

	it.each([null, undefined, "", "  "])("reads %j as no currency", (value) => {
		expect(normalizeCurrency(value)).toBeNull();
	});

	it.each(["EURO", "E1R", "€"])("rejects %j", (value) => {
		expect(() => normalizeCurrency(value)).toThrow(ShopkitConfigError);
	});
});

describe("client currency", () => {
	it("is null without a config value or a choice, and sends nothing", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch);
		expect(shopkit.currency).toBeNull();
		await shopkit.products.list();
		expect(sentCurrency(fake)).toBeNull();
	});

	it("rejects a malformed config value", () => {
		expect(() =>
			client(createFakeFetch([]).fetch, { currency: "euro" }),
		).toThrow(ShopkitConfigError);
	});

	it("sends the configured currency on every product read", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products/search", body: PAGE },
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const shopkit = client(fake.fetch, { currency: "eur" });
		expect(shopkit.currency).toBe("EUR");
		await shopkit.products.list();
		await shopkit.products.search({ search: "tee" });
		await shopkit.products.get(27);
		expect([0, 1, 2].map((i) => sentCurrency(fake, i))).toEqual([
			"EUR",
			"EUR",
			"EUR",
		]);
	});

	it("lets one read override the client's currency, or opt out with null", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { currency: "EUR" });
		await shopkit.products.list({ currency: "nok" });
		await shopkit.products.list({ currency: null });
		expect(sentCurrency(fake, 0)).toBe("NOK");
		expect(sentCurrency(fake, 1)).toBeNull();
	});

	it("sends the currency on cart creation, reads and line mutations", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", body: cartEnvelope({ currency: "EUR" }) },
			{ match: "POST /v2/cart/cart-1/items", body: cartEnvelope() },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "PATCH /v2/cart/cart-1/items/line-1", body: cartEnvelope() },
			{ match: "DELETE /v2/cart/cart-1/items/line-1", body: cartEnvelope() },
		]);
		const shopkit = client(fake.fetch, { currency: "EUR" });
		await shopkit.cart.add({ productId: 27 });
		await shopkit.cart.get("cart-1");
		await shopkit.cart.updateItem("cart-1", "line-1", 2);
		await shopkit.cart.removeItem("cart-1", "line-1");
		expect(fake.calls.map((_, i) => sentCurrency(fake, i))).toEqual([
			"EUR",
			"EUR",
			"EUR",
			"EUR",
			"EUR",
		]);
	});

	it("setCurrency switches the next request, notifies, and persists", async () => {
		const storage = createMemoryStorage();
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { storage });
		const seen: Array<string | null> = [];
		shopkit.onCurrencyChange((code) => seen.push(code));

		await shopkit.setCurrency("nok");
		expect(shopkit.currency).toBe("NOK");
		expect(seen).toEqual(["NOK"]);
		expect(await storage.get("qb_currency")).toBe("NOK");

		await shopkit.products.list();
		expect(sentCurrency(fake)).toBe("NOK");

		// A fresh client over the same storage remembers the choice.
		const again = client(fake.fetch, { storage, currency: "EUR" });
		expect(again.currency).toBe("NOK");
		await again.products.list();
		expect(sentCurrency(fake, 1)).toBe("NOK");
	});

	it("does not notify when the currency did not actually change", async () => {
		const shopkit = client(createFakeFetch([]).fetch, { currency: "EUR" });
		const listener = vi.fn();
		shopkit.onCurrencyChange(listener);
		await shopkit.setCurrency("eur");
		expect(listener).not.toHaveBeenCalled();
	});

	it("setCurrency(null) forgets the choice and returns to the default", async () => {
		const storage = createMemoryStorage();
		const shopkit = client(createFakeFetch([]).fetch, {
			storage,
			currency: "EUR",
		});
		await shopkit.setCurrency("NOK");
		await shopkit.setCurrency(null);
		expect(shopkit.currency).toBe("EUR");
		expect(await storage.get("qb_currency")).toBeNull();
	});

	it("rejects a malformed setCurrency value without changing anything", async () => {
		const shopkit = client(createFakeFetch([]).fetch, { currency: "EUR" });
		await expect(shopkit.setCurrency("euros")).rejects.toThrow(
			ShopkitConfigError,
		);
		expect(shopkit.currency).toBe("EUR");
	});

	it("ignores a tampered stored value rather than sending it", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_currency", "<script>");
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch, { storage });
		expect(shopkit.currency).toBeNull();
		await shopkit.products.list();
		expect(sentCurrency(fake)).toBeNull();
	});

	it("reads the remembered currency from a request's cookies on the server", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch, {
			storage: createRequestCookieStorage(
				new Headers({ cookie: "qb_currency=NOK; qb_cart_id=cart-1" }),
			),
		});
		expect(shopkit.currency).toBe("NOK");
		await shopkit.products.list();
		expect(sentCurrency(fake)).toBe("NOK");
	});

	it("uses the storage key prefix, like the cart id", async () => {
		const storage = createMemoryStorage();
		const shopkit = client(createFakeFetch([]).fetch, {
			storage,
			storageKeyPrefix: "shop2",
		});
		await shopkit.setCurrency("EUR");
		expect(await storage.get("shop2_currency")).toBe("EUR");
	});

	it("keeps the configured currency on a withStorage clone", () => {
		const shopkit = client(createFakeFetch([]).fetch, { currency: "EUR" });
		expect(shopkit.withStorage(createMemoryStorage()).currency).toBe("EUR");
	});
});

describe("checkout currency", () => {
	const SESSION = {
		sessionId: "sess-1",
		cartId: "cart-1",
		successUrl: "https://shop.test/success",
		cancelUrl: null,
		backUrl: null,
		language: null,
		origin: null,
		theme: "light",
		displayCurrency: { code: "NOK", rate: 0.95 },
		fields: {},
		data: {},
	};

	it("sends the client's currency in the session body", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const shopkit = client(fake.fetch, { currency: "nok" });
		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://shop.test/success",
		});
		expect((fake.calls[0]?.body as { currency?: string }).currency).toBe("NOK");
		expect(session.displayCurrency).toEqual({ code: "NOK", rate: 0.95 });
	});

	it("lets the call override or drop the currency", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/checkout/sessions", body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const shopkit = client(fake.fetch, { currency: "NOK" });
		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://shop.test/success",
			currency: "eur",
		});
		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://shop.test/success",
			currency: null,
		});
		const posts = fake.calls.filter((call) => call.method === "POST");
		expect((posts[0]?.body as { currency?: string }).currency).toBe("EUR");
		expect(posts[1]?.body).not.toHaveProperty("currency");
	});

	it("sends nothing when the client has no currency", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		await client(fake.fetch).checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://shop.test/success",
		});
		expect(fake.calls[0]?.body).not.toHaveProperty("currency");
	});

	it("start() sends the chosen currency to the handoff and reads the cart in it", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", body: cartEnvelope({ currency: "EUR" }) },
			{
				match: "POST /v2/checkout/handoff",
				body: {
					...SESSION,
					checkout: "v2",
					hostedUrl: "https://checkout.test/42/sess-1",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.setCurrency("EUR");
		await shopkit.checkout.start({ successUrl: "https://shop.test/success" });
		expect(sentCurrency(fake, 0)).toBe("EUR");
		const handoff = fake.calls.find((call) =>
			call.url.endsWith("/v2/checkout/handoff"),
		);
		expect((handoff?.body as { currency?: string }).currency).toBe("EUR");
	});
});

describe("product cache per currency", () => {
	it("keys lookups by currency, so a switch reads again", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{
				match: "GET /v2/products/prod_27",
				body: { ...PRODUCT, price: 862, currency: "EUR" },
			},
		]);
		const shopkit = client(fake.fetch);
		const sek = getProductPromise(shopkit, { id: 27 });
		expect(getProductPromise(shopkit, { id: 27 })).toBe(sek);
		await sek;

		await shopkit.setCurrency("EUR");
		const eur = getProductPromise(shopkit, { id: 27 });
		expect(eur).not.toBe(sek);
		expect((await eur)?.currency).toBe("EUR");
		expect(sentCurrency(fake, 0)).toBeNull();
		expect(sentCurrency(fake, 1)).toBe("EUR");

		clearProductCache(shopkit, { id: 27 });
		expect(fake.calls).toHaveLength(2);
	});

	it("honours a per-lookup currency", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		const shopkit = client(fake.fetch, { currency: "EUR" });
		await getProductPromise(shopkit, { id: 27, currency: "nok" });
		expect(sentCurrency(fake)).toBe("NOK");
	});
});

describe("CartStore and currency", () => {
	it("re-reads the same cart when the currency changes", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{
				match: "GET /v2/cart/cart-1",
				body: cartEnvelope({ currency: "EUR", total: 862 }),
			},
		]);
		const shopkit = client(fake.fetch, { storage });
		const store = new CartStore(shopkit);
		const stop = store.subscribe(() => undefined);
		await store.load();
		expect(store.getSnapshot().cart?.currency).toBe("SEK");

		await shopkit.setCurrency("EUR");
		await vi.waitFor(() =>
			expect(store.getSnapshot().cart?.currency).toBe("EUR"),
		);
		expect(store.getSnapshot().cart?.id).toBe("cart-1");
		expect(sentCurrency(fake, 1)).toBe("EUR");
		stop();
	});

	it("does not fetch a cart nobody loaded", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch);
		const store = new CartStore(shopkit);
		const stop = store.subscribe(() => undefined);
		await shopkit.setCurrency("EUR");
		expect(fake.calls).toHaveLength(0);
		stop();
	});

	it("load() re-reads a cart loaded before an unobserved switch", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ currency: "EUR" }) },
		]);
		const shopkit = client(fake.fetch, { storage });
		const store = new CartStore(shopkit);
		await store.load();
		await shopkit.setCurrency("EUR");
		expect((await store.load())?.currency).toBe("EUR");
		// And once it is in the right currency it short-circuits again.
		await store.load();
		expect(fake.calls).toHaveLength(2);
	});
});

/**
 * A fetch whose responses the test releases by hand, in any order — for
 * reads that are overtaken while they are out.
 */
function deferredFetch() {
	const pending: Array<{
		url: string;
		method: string;
		respond: (body: unknown, status?: number) => void;
	}> = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(input, init);
		return new Promise<Response>((resolve) => {
			pending.push({
				url: request.url,
				method: request.method.toUpperCase(),
				respond: (body, status = 200) =>
					resolve(
						new Response(JSON.stringify(body), {
							status,
							headers: { "content-type": "application/json" },
						}),
					),
			});
		});
	}) as unknown as typeof globalThis.fetch;
	return { fetch: fetchImpl, pending };
}

describe("CartStore reads that are overtaken", () => {
	it("a stale read failing after a switch does not put the store in error", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = deferredFetch();
		const shopkit = client(fake.fetch, { storage });
		const store = new CartStore(shopkit, cartEnvelope().data as never);
		const stop = store.subscribe(() => undefined);

		const stale = store.refresh(); // in SEK
		await vi.waitFor(() => expect(fake.pending).toHaveLength(1));
		await shopkit.setCurrency("EUR"); // starts its own refresh
		await vi.waitFor(() => expect(fake.pending).toHaveLength(2));

		fake.pending[1]?.respond(cartEnvelope({ currency: "EUR" }));
		await vi.waitFor(() =>
			expect(store.getSnapshot().cart?.currency).toBe("EUR"),
		);
		fake.pending[0]?.respond({ message: "boom", statusCode: 500 }, 500);
		await stale;

		expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
		expect(store.getSnapshot().cart?.currency).toBe("EUR");
		stop();
	});

	it("a read sent before an add does not overwrite the cart the add returned", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = deferredFetch();
		const shopkit = client(fake.fetch, { storage });
		const store = new CartStore(shopkit, cartEnvelope().data as never);

		const read = store.refresh();
		await vi.waitFor(() => expect(fake.pending).toHaveLength(1));
		const add = store.add({ productId: "27", quantity: 1 });
		// add() = resolve the remembered cart, then post the line.
		await vi.waitFor(() => expect(fake.pending).toHaveLength(2));
		fake.pending[1]?.respond(cartEnvelope());
		await vi.waitFor(() => expect(fake.pending).toHaveLength(3));
		expect(fake.pending[2]?.method).toBe("POST");

		fake.pending[2]?.respond(cartEnvelope({ itemCount: 1 }));
		await add;
		fake.pending[0]?.respond(cartEnvelope({ itemCount: 0 }));
		await read;

		expect(store.getSnapshot()).toMatchObject({
			status: "ready",
			itemCount: 1,
		});
	});
	it("a resync overtaken by a second switch does not land the older currency", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = deferredFetch();
		const shopkit = client(fake.fetch, { storage });
		const store = new CartStore(shopkit, cartEnvelope().data as never);
		const stop = store.subscribe(() => undefined);

		const add = store.add({ productId: "27", quantity: 1 });
		await vi.waitFor(() => expect(fake.pending).toHaveLength(1));
		fake.pending[0]?.respond(cartEnvelope());
		await vi.waitFor(() => expect(fake.pending).toHaveLength(2));
		// The add is out when the shopper switches to EUR (refresh #2).
		await shopkit.setCurrency("EUR");
		await vi.waitFor(() => expect(fake.pending).toHaveLength(3));
		// The add lands in SEK, so the store resyncs in EUR (#3).
		fake.pending[1]?.respond(cartEnvelope({ itemCount: 1 }));
		await add;
		await vi.waitFor(() => expect(fake.pending).toHaveLength(4));
		expect(
			new URL(fake.pending[3]?.url ?? "").searchParams.get("currency"),
		).toBe("EUR");
		// ...and switches again before that resync answers (refresh #4).
		await shopkit.setCurrency("NOK");
		await vi.waitFor(() => expect(fake.pending).toHaveLength(5));

		fake.pending[4]?.respond(cartEnvelope({ currency: "NOK", itemCount: 1 }));
		await vi.waitFor(() =>
			expect(store.getSnapshot().cart?.currency).toBe("NOK"),
		);
		fake.pending[3]?.respond(cartEnvelope({ currency: "EUR", itemCount: 1 }));
		fake.pending[2]?.respond(cartEnvelope({ currency: "EUR", itemCount: 1 }));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(store.getSnapshot().cart?.currency).toBe("NOK");
		expect(await store.load()).toMatchObject({ currency: "NOK" });
		expect(fake.pending).toHaveLength(5);
		stop();
	});
});

describe("describeCurrency", () => {
	it("is the base currency when nothing is chosen", () => {
		expect(describeCurrency(SHOP, null)).toMatchObject({
			currency: "SEK",
			baseCurrency: "SEK",
			mode: "base",
			rate: 1,
			chargeCurrency: "SEK",
		});
	});

	it("charges in a charge-mode currency", () => {
		expect(describeCurrency(SHOP, "eur")).toMatchObject({
			currency: "EUR",
			mode: "charge",
			rate: 0.0871,
			chargeCurrency: "EUR",
		});
	});

	it("charges the base currency for a display-mode currency", () => {
		expect(describeCurrency(SHOP, "NOK")).toMatchObject({
			currency: "NOK",
			mode: "display",
			chargeCurrency: "SEK",
		});
	});

	it("falls back to the base currency for one the shop does not offer", () => {
		expect(describeCurrency(SHOP, "USD")).toMatchObject({
			currency: "SEK",
			mode: "base",
		});
	});

	it("reports the selection unresolved before the shop is known", () => {
		expect(describeCurrency(null, "EUR")).toMatchObject({
			currency: "EUR",
			baseCurrency: null,
			currencies: [],
		});
	});
});

describe("getShopPromise", () => {
	it("shares one shop read per client and retries after a failure", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", status: 500, body: { message: "x" } },
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		const shopkit = client(fake.fetch);
		await expect(getShopPromise(shopkit)).rejects.toThrow();
		const first = getShopPromise(shopkit);
		expect(getShopPromise(shopkit)).toBe(first);
		expect((await first).currencies).toHaveLength(3);
		expect(fake.calls).toHaveLength(2);
	});
});
