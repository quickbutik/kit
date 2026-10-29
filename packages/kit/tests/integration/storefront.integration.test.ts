/**
 * End-to-end check against a live API. Excluded from `pnpm test`. Run it with:
 *
 *   SHOPKIT_IT_PUBLISHABLE_KEY=qb_pk_… \
 *   SHOPKIT_IT_API_URL=https://… \
 *   SHOPKIT_IT_CHECKOUT_URL=https://… \
 *   SHOPKIT_IT_PROMOCODE=… \
 *   pnpm --filter @quickbutik/kit test:integration
 *
 * The shop needs checkout-v2 activated, a visible product, free shipping, and
 * a 100%-off promo code. A zero total is the only way to place an order
 * without driving a payment provider's card fields.
 *
 * Steps 9–10 stand in for the hosted checkout and call the API directly.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	type Cart,
	type CheckoutSession,
	createRequestCookieStorage,
	createShopkitClient,
	parseCookieHeader,
	type ShopkitClient,
} from "../../src/index.js";

const PUBLISHABLE_KEY = process.env.SHOPKIT_IT_PUBLISHABLE_KEY;
const API_URL = process.env.SHOPKIT_IT_API_URL;
const CHECKOUT_URL = process.env.SHOPKIT_IT_CHECKOUT_URL;
const PROMOCODE = process.env.SHOPKIT_IT_PROMOCODE;
const STOREFRONT_ORIGIN =
	process.env.SHOPKIT_IT_ORIGIN ?? "http://localhost:3000";

/**
 * The "browser" cookie jar. shopkit writes `Set-Cookie` strings into `collect`;
 * folding them back into `cookieHeader` is what a server framework does around
 * a request, and it is how this test proves the cart survives between clients.
 */
let cookieHeader = "";
const setCookies: string[] = [];

/** Narrows an env var to a string, with a message that says what to set. */
function required(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`${name} is not set — see the header of this file.`);
	}
	return value;
}

function shopkit(): ShopkitClient {
	return createShopkitClient({
		publishableKey: required("SHOPKIT_IT_PUBLISHABLE_KEY", PUBLISHABLE_KEY),
		apiUrl: API_URL,
		checkoutUrl: CHECKOUT_URL,
		storage: createRequestCookieStorage(cookieHeader, { collect: setCookies }),
	});
}

function applySetCookies(): void {
	for (const raw of setCookies.splice(0)) {
		const pair = raw.split(";")[0] ?? "";
		const eq = pair.indexOf("=");
		const name = pair.slice(0, eq);
		const value = pair.slice(eq + 1);
		const jar = parseCookieHeader(cookieHeader);
		if (value === "") delete jar[name];
		else jar[name] = decodeURIComponent(value);
		cookieHeader = Object.entries(jar)
			.map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
			.join("; ");
	}
}

/** Raw gateway call — only for the steps that stand in for the hosted checkout. */
async function gateway(
	method: string,
	path: string,
	body?: unknown,
): Promise<Record<string, unknown>> {
	const response = await fetch(`${API_URL}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${PUBLISHABLE_KEY}`,
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`,
		);
	}
	return text ? JSON.parse(text) : {};
}

describe("storefront end-to-end", () => {
	beforeAll(() => {
		if (!PUBLISHABLE_KEY || !API_URL || !CHECKOUT_URL || !PROMOCODE) {
			throw new Error(
				"Set SHOPKIT_IT_PUBLISHABLE_KEY, SHOPKIT_IT_API_URL, SHOPKIT_IT_CHECKOUT_URL " +
					"and SHOPKIT_IT_PROMOCODE — see the header of this file.",
			);
		}
	});

	let productId: string;
	let cart: Cart;
	let session: CheckoutSession;
	let handoffUrl: string;
	let placedOrderNumber: number;

	it("1. builds a client from the publishable key alone", () => {
		const client = shopkit();
		expect(client.shopPrefix.length).toBeGreaterThan(0);
		expect(client.runtime.environment).toBe("server");
		expect(client.runtime.storage).toBe("cookie");
		expect(client.runtime.persistent).toBe(true);
		expect(client.scopes.has("cart:write")).toBe(true);
	});

	it("2. reads the shop and the catalog", async () => {
		const shop = await shopkit().shop.get();
		expect(shop.name.length).toBeGreaterThan(0);

		const products = await shopkit().products.list({ limit: 3 });
		expect(products.data.length).toBeGreaterThan(0);
		const first = products.data[0];
		if (!first)
			throw new Error("the shop has no visible products to test with");
		productId = first.id;
		expect(productId.startsWith("prod_")).toBe(true);

		// Regression guard: the id the LIST returns must work against the DETAIL
		// endpoint.
		const single = await shopkit().products.get(productId);
		expect(single?.id).toBe(productId);

		const categories = await shopkit().categories.list({ limit: 3 });
		expect(Array.isArray(categories.data)).toBe(true);
	});

	it("3. does not create a cart just because one was read", async () => {
		expect(await shopkit().cart.current()).toBeNull();
		expect(cookieHeader).toBe("");
	});

	it("4. creates, fills and remembers the cart", async () => {
		cart = (await shopkit().cart.add({ productId, quantity: 2 })) as Cart;
		applySetCookies();
		expect(cart.itemCount).toBe(2);
		expect(cart.total).toBeGreaterThan(0);
		expect(cookieHeader).toContain("qb_cart_id");
	});

	it("5. lets a brand-new client resume that cart from the cookie", async () => {
		const resumed = await shopkit().cart.current();
		expect(resumed?.id).toBe(cart.id);
	});

	it("6. starts checkout and builds the hosted handoff URL", async () => {
		const started = await shopkit().checkout.start({
			successUrl: `${STOREFRONT_ORIGIN}/success`,
			cancelUrl: `${STOREFRONT_ORIGIN}/cart`,
			backUrl: `${STOREFRONT_ORIGIN}/`,
			language: "sv",
		});
		applySetCookies();

		// Everything from step 7 on drives the checkout-v2 SPA, so this suite needs
		// a shop that has checkout-v2 ACTIVATED. A fresh shop may not — say so by
		// name rather than failing later with a confusing 404 on the handoff URL.
		expect(
			started.checkout,
			"this shop is on the legacy checkout; activate checkout-v2 for it " +
				"(POST /v2/checkout/bootstrap with a merchant token) before running " +
				"this suite",
		).toBe("v2");
		if (started.checkout !== "v2") return;

		session = started.session;
		handoffUrl = started.url;

		expect(session.cartId).toBe(cart.id);
		expect(session.backUrl).toBe(`${STOREFRONT_ORIGIN}/`);
		// The path carries the shop's NUMERIC id from the cart — the key's prefix
		// (`shopPrefix`) is a CDN folder name the checkout does not recognise.
		expect(handoffUrl).toBe(
			`${CHECKOUT_URL}/checkout/${cart.storeId}/${session.sessionId}?lang=sv`,
		);
		expect(handoffUrl).not.toContain(`/checkout/${shopkit().shopPrefix}/`);
		expect(cookieHeader).toContain("qb_checkout_session");
	});

	it("7. serves the hosted checkout at that URL", async () => {
		const response = await fetch(handoffUrl, { redirect: "manual" });
		expect(response.status).toBe(200);
	});

	it("8. reports no order yet, before any payment", async () => {
		const confirmation = await shopkit().checkout.confirmation(
			session.sessionId,
		);
		expect(confirmation.status).toBe("no_attempt");
	});

	it("9. [stands in for the hosted checkout] fills the session to a zero total", async () => {
		const patched = await gateway(
			"PATCH",
			`/v2/checkout/sessions/${session.sessionId}`,
			{
				customer: {
					email: "headless@example.com",
					postalCode: "11122",
					customerType: "b2c",
				},
				shipping_address: {
					firstName: "Head",
					lastName: "Less",
					line1: "Testgatan 1",
					city: "Stockholm",
					postalCode: "11122",
					country: "SE",
					phone: "0701234567",
				},
				discount_code: { code: PROMOCODE },
			},
		);

		const data = patched.data as Record<
			string,
			{ value?: Array<Record<string, unknown>> } | undefined
		>;
		const options = data.available_shipping_options?.value;
		expect(options?.length ?? 0).toBeGreaterThan(0);
		const option = options?.[0];
		if (!option)
			throw new Error("no shipping option available for the test address");

		const withShipping = await gateway(
			"PATCH",
			`/v2/checkout/sessions/${session.sessionId}`,
			{
				shipping_option: {
					shippingMethodId: option.shippingMethodId,
					price: option.price,
					name: option.name,
				},
				accept_terms: { accepted: true },
			},
		);

		const totals = withShipping.data as Record<
			string,
			{ value: { total: number; totalDiscount: number } } | undefined
		>;
		const total = totals.order_total?.value;
		if (!total) throw new Error("the session resolved no order_total");
		expect(total.totalDiscount).toBeGreaterThan(0);
		// Strictly 0: place-order refuses anything else, and the discount maths has
		// to land on the öre.
		expect(total.total).toBe(0);
	});

	it("10. [stands in for the hosted checkout] places the zero-total order", async () => {
		const placed = await gateway(
			"POST",
			`/v2/checkout/sessions/${session.sessionId}/place-order`,
			{},
		);
		expect(typeof placed.orderNumber).toBe("number");
		placedOrderNumber = placed.orderNumber as number;
	});

	it("11. confirms the order through shopkit, as a thank-you page would", async () => {
		const outcome = await shopkit().checkout.pollConfirmation(
			session.sessionId,
		);
		applySetCookies();
		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.orderNumber).toBe(placedOrderNumber);
		}
	});

	it("12. forgets the bought cart so the next visit starts clean", async () => {
		expect(cookieHeader).not.toContain("qb_cart_id=");
		expect(await shopkit().cart.current()).toBeNull();
	});

	it("13. parses the redirect the hosted checkout sends the shopper back with", () => {
		const parsed = shopkit().checkout.parseReturnUrl(
			`${STOREFRONT_ORIGIN}/success/${placedOrderNumber}?hash=deadbeef&t=1750000000`,
		);
		expect(parsed?.orderNumber).toBe(placedOrderNumber);
	});
});
