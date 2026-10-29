import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendCheckoutHandoffParams } from "../src/analytics/handoff.js";
import { serializeConsentState } from "../src/consent/cookie.js";
import type { ConsentState } from "../src/consent/types.js";
import type { CookieAccessor } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { ShopkitConfig } from "../src/sdk/config.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

/**
 * The server half of consent: `shopkit.consent.read()` and the handoff
 * `checkout.start()` decorates on its own when the client has cookie access.
 * The cookie accessor here is a plain map, shaped like Next's cookie jar.
 */

const ANALYTICS_ONLY: ConsentState = {
	status: "decided",
	analytics: true,
	marketing: false,
	decidedAt: "2026-10-01T10:00:00.000Z",
	revision: 1,
};

const GA_COOKIES = {
	_ga: "GA1.1.123456789.1700000000",
	_ga_ABC123: "GS1.1.1700000001.1.0.1700000001.0.0.0",
};

function jar(
	values: Record<string, string>,
	{ withGetAll = true }: { withGetAll?: boolean } = {},
): CookieAccessor {
	return {
		get: (name) => values[name] ?? null,
		set: (name, value) => {
			values[name] = value;
		},
		...(withGetAll && {
			getAll: () =>
				Object.entries(values).map(([name, value]) => ({ name, value })),
		}),
	};
}

function serverClient(
	cookies: CookieAccessor | undefined,
	extra: Partial<ShopkitConfig> = {},
) {
	const fake = createFakeFetch([
		{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
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
	]);
	const shopkit = createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fake.fetch,
		maxRetries: 0,
		...(cookies && { cookies }),
		...extra,
	});
	return { shopkit, fake };
}

async function startedUrl(
	cookies: CookieAccessor | undefined,
	extra: Partial<ShopkitConfig> = {},
): Promise<URL> {
	const { shopkit } = serverClient(cookies, extra);
	const result = await shopkit.checkout.start({
		cartId: "cart-1",
		successUrl: "https://myshop.test/order",
	});
	return new URL(result.url);
}

function clearDocumentCookies(): void {
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

beforeEach(clearDocumentCookies);
afterEach(clearDocumentCookies);

describe("shopkit.consent", () => {
	it("reads the decision through the cookie accessor", async () => {
		const { shopkit } = serverClient(
			jar({ qb_consent: serializeConsentState(ANALYTICS_ONLY) }),
		);
		const actual = await shopkit.consent.read();
		expect(actual).toEqual(ANALYTICS_ONLY);
	});

	it("reads undecided when there is no cookie, or one for an older revision", async () => {
		const none = serverClient(jar({}));
		expect((await none.shopkit.consent.read()).status).toBe("undecided");

		const bumped = serverClient(
			jar({ qb_consent: serializeConsentState(ANALYTICS_ONLY) }),
			{ consent: { revision: 2 } },
		);
		const actual = await bumped.shopkit.consent.read();
		expect(actual.status).toBe("undecided");
		expect(actual.revision).toBe(2);
	});

	it("takes the revision and cookie name from the config", async () => {
		const state = { ...ANALYTICS_ONLY, revision: 3 };
		const { shopkit } = serverClient(
			jar({ my_consent: serializeConsentState(state) }),
			{ consent: { revision: 3, cookieName: "my_consent" } },
		);
		expect(shopkit.consent.revision).toBe(3);
		expect(shopkit.consent.cookieName).toBe("my_consent");
		expect(shopkit.consent.enabled).toBe(true);
		expect(await shopkit.consent.read()).toEqual(state);
	});

	it("reads document.cookie in a browser client with no accessor", async () => {
		// biome-ignore lint/suspicious/noDocumentCookie: planting the cookie a browser would hold.
		document.cookie = `qb_consent=${encodeURIComponent(serializeConsentState(ANALYTICS_ONLY))}; path=/`;
		const { shopkit } = serverClient(undefined);
		expect(await shopkit.consent.read()).toEqual(ANALYTICS_ONLY);
	});

	it("is disabled by consent: false", () => {
		const { shopkit } = serverClient(jar({}), { consent: false });
		expect(shopkit.consent.enabled).toBe(false);
	});
});

describe("checkout.start() on a server client", () => {
	it("forwards the decision and the GA ids when the accessor has getAll()", async () => {
		const url = await startedUrl(
			jar({
				qb_consent: serializeConsentState(ANALYTICS_ONLY),
				...GA_COOKIES,
			}),
		);
		expect(url.searchParams.get("consentCategories")).toBe("analytics");
		expect(url.searchParams.get("gaClientId")).toBe("123456789.1700000000");
		expect(url.searchParams.get("gaSessionId")).toBe("1700000001");
	});

	it("forwards the decision but no GA ids without getAll()", async () => {
		const url = await startedUrl(
			jar(
				{ qb_consent: serializeConsentState(ANALYTICS_ONLY), ...GA_COOKIES },
				{ withGetAll: false },
			),
		);
		expect(url.searchParams.get("consentCategories")).toBe("analytics");
		expect(url.searchParams.has("gaClientId")).toBe(false);
		expect(url.searchParams.has("gaSessionId")).toBe(false);
	});

	it("forwards an undecided shopper as consentCategories= and no GA ids", async () => {
		const url = await startedUrl(jar({ ...GA_COOKIES }));
		expect(url.searchParams.get("consentCategories")).toBe("");
		expect(url.searchParams.has("gaClientId")).toBe(false);
	});

	it("appends nothing with consent: false", async () => {
		const url = await startedUrl(
			jar({
				qb_consent: serializeConsentState(ANALYTICS_ONLY),
				...GA_COOKIES,
			}),
			{ consent: false },
		);
		expect(url.toString()).toBe("https://checkout.test/checkout/42/sess-1");
	});

	it("leaves a browser client's URL alone (the hooks and elements decorate it)", async () => {
		// biome-ignore lint/suspicious/noDocumentCookie: a decision the browser holds.
		document.cookie = `qb_consent=${encodeURIComponent(serializeConsentState(ANALYTICS_ONLY))}; path=/`;
		const url = await startedUrl(undefined);
		expect(url.toString()).toBe("https://checkout.test/checkout/42/sess-1");
	});
});

describe("appendCheckoutHandoffParams", () => {
	it("is idempotent: a second decoration replaces the first, it never stacks", () => {
		const withGa = appendCheckoutHandoffParams(
			"https://checkout.test/checkout/42/s1",
			ANALYTICS_ONLY,
			{ cookies: "_ga=GA1.1.111.222" },
		);
		const again = appendCheckoutHandoffParams(withGa, ANALYTICS_ONLY, {
			cookies: "_ga=GA1.1.111.222",
		});
		expect(again).toBe(withGa);

		// The decision changed between the two: the GA id must not survive.
		const denied = appendCheckoutHandoffParams(
			withGa,
			{ ...ANALYTICS_ONLY, analytics: false },
			{ cookies: "_ga=GA1.1.111.222" },
		);
		const url = new URL(denied);
		expect(url.searchParams.get("consentCategories")).toBe("");
		expect(url.searchParams.has("gaClientId")).toBe(false);
		expect(url.searchParams.getAll("consentCategories")).toHaveLength(1);
	});

	it("reads the GA ids from a cookie list as well as a header", () => {
		const url = new URL(
			appendCheckoutHandoffParams(
				"https://checkout.test/checkout/42/s1",
				ANALYTICS_ONLY,
				{
					cookies: Object.entries(GA_COOKIES).map(([name, value]) => ({
						name,
						value,
					})),
				},
			),
		);
		expect(url.searchParams.get("gaClientId")).toBe("123456789.1700000000");
		expect(url.searchParams.get("gaSessionId")).toBe("1700000001");
	});
});

describe("checkout.start() with a currency and consent together", () => {
	it("sends the currency in the handoff body and the consent on the URL, neither stacked nor dropped", async () => {
		const { shopkit, fake } = serverClient(
			jar({
				qb_consent: serializeConsentState(ANALYTICS_ONLY),
				qb_currency: "EUR",
				...GA_COOKIES,
			}),
		);
		const result = await shopkit.checkout.start({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});
		const handoff = fake.calls.find((call) =>
			call.url.endsWith("/v2/checkout/handoff"),
		);
		expect(handoff?.body).toMatchObject({ currency: "EUR" });
		const url = new URL(result.url);
		expect(url.searchParams.getAll("consentCategories")).toEqual(["analytics"]);
		expect(url.searchParams.getAll("gaClientId")).toEqual([
			"123456789.1700000000",
		]);
		// Decorating again (the browser does, after a server start) changes nothing.
		expect(
			appendCheckoutHandoffParams(result.url, ANALYTICS_ONLY, {
				cookies: Object.entries(GA_COOKIES).map(([name, value]) => ({
					name,
					value,
				})),
			}),
		).toBe(result.url);
	});
});
