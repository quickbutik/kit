import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import {
	DEFAULT_API_URL,
	DEFAULT_CHECKOUT_URL,
	resolveConfig,
} from "../src/sdk/config.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

describe("shopPrefix", () => {
	it("is the key's third segment, exposed under the name of what it is", () => {
		const actual = resolveConfig({ publishableKey: TEST_KEY });

		expect(actual.shopPrefix).toBe("shop123");
		// Not as `shopId`: that name suggests the numeric id the hosted checkout
		// wants, which this value is not.
		expect(actual).not.toHaveProperty("shopId");
	});

	it("is on the client, with `shopId` kept as a deprecated alias for one beta", () => {
		const shopkit = createShopkitClient({
			publishableKey: "qb_pk_101928Y_deadbeefcafe",
			fetch: createFakeFetch([]).fetch,
			storage: "memory",
		});

		expect(shopkit.shopPrefix).toBe("101928Y");
		expect(shopkit.shopId).toBe(shopkit.shopPrefix);
	});
});

/**
 * The default host is a published contract, not an implementation detail: a
 * storefront that omits `apiUrl` ships whatever this constant says, and only
 * the commerce host serves publishable keys with wildcard CORS. These tests
 * pin the value *and* the URL a request actually goes to, so a change to
 * either the constant or the `/v2` join in the transport has to be deliberate.
 */
describe("default apiUrl", () => {
	it("resolves to the commerce host when apiUrl is omitted", () => {
		const actual = resolveConfig({ publishableKey: TEST_KEY });

		expect(actual.apiUrl).toBe("https://commerce.quickbutik.com");
		expect(DEFAULT_API_URL).toBe("https://commerce.quickbutik.com");
	});

	it("strips a trailing /v2 an operator pasted onto the commerce host", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			apiUrl: "https://commerce.quickbutik.com/v2/",
		});

		expect(actual.apiUrl).toBe("https://commerce.quickbutik.com");
	});

	it("sends requests to https://commerce.quickbutik.com/v2 by default", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [], has_more: false, next_cursor: null },
			},
		]);
		const shopkit = createShopkitClient({
			publishableKey: TEST_KEY,
			fetch: fake.fetch,
			storage: "memory",
			maxRetries: 0,
		});

		await shopkit.products.list();

		expect(fake.calls[0]?.url).toMatch(
			/^https:\/\/commerce\.quickbutik\.com\/v2\/products(\?|$)/,
		);
	});
});

/**
 * The checkout default is the checkout-v2 host, NOT `checkout.quickbutik.com`:
 * that is the legacy checkout, which reads the last path segment as an order
 * id and answers "we couldn't find it" for a session id.
 */
describe("default checkoutUrl", () => {
	it("is the checkout-v2 host, never the legacy one", () => {
		const actual = resolveConfig({ publishableKey: TEST_KEY });

		expect(DEFAULT_CHECKOUT_URL).toBe("https://pay.quickbutik.com");
		expect(actual.checkoutUrl).toBe("https://pay.quickbutik.com");
		expect(actual.checkoutUrl).not.toBe("https://checkout.quickbutik.com");
	});

	it("reports a defaulted checkoutUrl as not configured", () => {
		// This flag decides whether a locally built checkout-v2 URL beats the one
		// the platform returns. Defaulted must mean "let the platform decide".
		const actual = resolveConfig({ publishableKey: TEST_KEY });

		expect(actual.checkoutUrlConfigured).toBe(false);
	});

	it("reports an explicitly set checkoutUrl as configured", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			checkoutUrl: "https://checkout.rig.test/",
		});

		expect(actual.checkoutUrlConfigured).toBe(true);
		expect(actual.checkoutUrl).toBe("https://checkout.rig.test");
	});

	it("treats an empty checkoutUrl as not configured", () => {
		const actual = resolveConfig({
			publishableKey: TEST_KEY,
			checkoutUrl: "",
		});

		expect(actual.checkoutUrlConfigured).toBe(false);
	});

	it("does not let cloning a client turn a defaulted checkoutUrl into a configured one", () => {
		// `withStorage()` rebuilds from `toConfig()`. Carrying the resolved value
		// across would silently flip the URL precedence in `checkout.start()`.
		const shopkit = createShopkitClient({
			publishableKey: TEST_KEY,
			fetch: createFakeFetch([]).fetch,
			storage: "memory",
		});

		const cloned = shopkit.withStorage(createMemoryStorage());

		expect(
			resolveConfig({ publishableKey: TEST_KEY }).checkoutUrlConfigured,
		).toBe(false);
		expect(cloned.checkoutUrl).toBe(DEFAULT_CHECKOUT_URL);
	});
});
