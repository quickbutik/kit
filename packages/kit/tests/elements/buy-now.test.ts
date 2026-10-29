import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { ShopkitClient } from "../../src/sdk/client.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "../helpers.js";
import {
	$,
	ensureDefined,
	flush,
	mount,
	mountWithProduct,
	PRODUCT,
	resetDom,
	SIMPLE_PRODUCT,
} from "./helpers.js";

ensureDefined();

const SF_ID = "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD";

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

const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
});

/** Create, add, the handoff's cart read, the handoff — one buy-now. */
function buyNowRoutes(): FakeRoute[] {
	return [
		{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		{
			match: "PATCH /v2/checkout/sessions/sess-1",
			body: { fields: {}, data: {} },
		},
	];
}

function shopWith(routes: FakeRoute[]) {
	const fake = createFakeFetch(routes);
	const shop = configure({
		// Consent and analytics are on by default; this suite tests the
		// elements without them (they have their own suites).
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fake.fetch,
		currency: "SEK",
		maxRetries: 0,
	});
	return { fake, shop };
}

function handoffBody(fake: ReturnType<typeof createFakeFetch>) {
	return fake.calls.find((c) =>
		new URL(c.url).pathname.endsWith("/v2/checkout/handoff"),
	)?.body as Record<string, unknown> | undefined;
}

type QbBuyNow = HTMLElement & { buy(quantity?: number): Promise<void> };

/** The back button bringing the page back from the back/forward cache. */
function restoreFromBfcache(): void {
	window.dispatchEvent(
		Object.assign(new Event("pageshow"), { persisted: true }),
	);
}

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
	resetDom();
	assign = vi.fn();
	vi.spyOn(window.location, "assign").mockImplementation(
		assign as unknown as (url: string | URL) => void,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("<qb-buy-now>", () => {
	it("adds the product, starts the checkout and navigates", async () => {
		const { fake, shop } = shopWith(buyNowRoutes());
		const started = vi.fn();
		const host = await mountWithProduct(
			`<qb-product>
				<qb-buy-now success-url="/order" back-url="/tee" theme="dark" quantity="2">
					<button id="buy">Köp nu</button>
				</qb-buy-now>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);
		host.addEventListener("qb:checkout-started", started);

		$(host, "#buy").click();
		await flush(8);

		expect(
			fake.calls.find((c) => new URL(c.url).pathname.endsWith("/items"))?.body,
		).toEqual({
			productId: "prod_1",
			variantId: 1,
			quantity: 2,
		});
		// The same attribute rules as <qb-checkout-button>, by the same code.
		const body = handoffBody(fake);
		expect(body?.successUrl).toBe(`${window.location.origin}/order`);
		expect(body?.backUrl).toBe(`${window.location.origin}/tee`);
		expect(body?.theme).toBe("dark");
		expect(started).toHaveBeenCalledTimes(1);
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
		// The shared store saw the add, so a badge on a page the shopper comes
		// back to is not one item short.
		expect(shop.cartStore.getSnapshot().itemCount).toBe(1);
	});

	it("stays busy after navigating, until the page is restored from the bfcache", async () => {
		const { fake } = shopWith([
			...buyNowRoutes(),
			...buyNowRoutes(),
			// The second buy reads the remembered cart before adding to it.
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const host = await mountWithProduct(
			`<qb-product>
				<qb-buy-now success-url="/order"><button id="buy">Köp nu</button></qb-buy-now>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);
		const button = $(host, "#buy") as HTMLButtonElement;
		const adds = () =>
			fake.calls.filter((c) => new URL(c.url).pathname.endsWith("/items"))
				.length;

		button.click();
		await flush(8);
		expect(assign).toHaveBeenCalledTimes(1);
		// The navigation has not committed yet: a second click must buy nothing.
		expect(button.disabled).toBe(true);
		await ($(host, "qb-buy-now") as QbBuyNow).buy();
		await flush(8);
		expect(adds()).toBe(1);

		window.dispatchEvent(new Event("pageshow"));
		expect(button.disabled).toBe(true);

		restoreFromBfcache();
		expect(button.disabled).toBe(false);
		button.click();
		await flush(8);
		expect(adds()).toBe(2);
		restoreFromBfcache();
	});

	it("stays disabled until the selection pins a variant", async () => {
		shopWith([]);
		const host = await mountWithProduct(
			`<qb-product><qb-buy-now success-url="/order"><button id="buy">Köp nu</button></qb-buy-now></qb-product>`,
			PRODUCT,
		);
		expect(($(host, "#buy") as HTMLButtonElement).disabled).toBe(true);
		expect($(host, "qb-buy-now").hasAttribute("blocked")).toBe(true);
	});

	it("emits the handoff and stays put with no-redirect", async () => {
		shopWith(buyNowRoutes());
		const started = vi.fn();
		const host = await mountWithProduct(
			`<qb-product><qb-buy-now no-redirect success-url="/order"><button id="buy">Köp nu</button></qb-buy-now></qb-product>`,
			SIMPLE_PRODUCT,
		);
		host.addEventListener("qb:checkout-started", (event) =>
			started((event as CustomEvent).detail),
		);

		$(host, "#buy").click();
		await flush(8);

		expect(assign).not.toHaveBeenCalled();
		expect(started).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://checkout.test/checkout/42/sess-1",
				checkout: "v2",
			}),
		);
	});

	it("warns once and comes back to this page without a success-url", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { fake } = shopWith(buyNowRoutes());
		const host = await mountWithProduct(
			`<qb-product><qb-buy-now><button id="buy">Köp nu</button></qb-buy-now></qb-product>`,
			SIMPLE_PRODUCT,
		);

		$(host, "#buy").click();
		await flush(8);

		expect(handoffBody(fake)?.successUrl).toBe(window.location.href);
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/<qb-buy-now> has no success-url/),
		);
	});

	it("reports a failed handoff as a qb:error, not a thrown rejection", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		shopWith([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 409,
				body: { message: "nope", statusCode: 409 },
			},
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const errors = vi.fn();
		const host = await mountWithProduct(
			`<qb-product><qb-buy-now success-url="/order"><button id="buy">Köp nu</button></qb-buy-now></qb-product>`,
			SIMPLE_PRODUCT,
		);
		host.addEventListener("qb:error", errors);

		$(host, "#buy").click();
		await flush(8);

		expect(errors).toHaveBeenCalledTimes(1);
		expect($(host, "qb-buy-now").getAttribute("state")).toBe("error");
		expect(assign).not.toHaveBeenCalled();
		expect(($(host, "#buy") as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('data-qb-action="buy-now" on <qb-product>', () => {
	it("reads the checkout attributes off the button", async () => {
		const { fake } = shopWith(buyNowRoutes());
		const host = await mountWithProduct(
			`<qb-product>
				<button id="buy" data-qb-action="buy-now" data-qb-quantity="3"
					data-qb-success-url="/thanks" data-qb-back-url="/p/tee">Köp nu</button>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);

		$(host, "#buy").click();
		await flush(8);

		expect(
			fake.calls.find((c) => new URL(c.url).pathname.endsWith("/items"))?.body,
		).toEqual({
			productId: "prod_1",
			variantId: 1,
			quantity: 3,
		});
		expect(handoffBody(fake)?.successUrl).toBe(
			`${window.location.origin}/thanks`,
		);
		expect(handoffBody(fake)?.backUrl).toBe(`${window.location.origin}/p/tee`);
		expect(assign).toHaveBeenCalledTimes(1);
	});

	it("is blocked, with the missing groups, while the selection is incomplete", async () => {
		const { fake } = shopWith([]);
		const blocked = vi.fn();
		const host = await mountWithProduct(
			`<qb-product><button id="buy" data-qb-action="buy-now" data-qb-success-url="/order">Köp nu</button></qb-product>`,
			PRODUCT,
		);
		host.addEventListener("qb:add-to-cart-blocked", (event) =>
			blocked((event as CustomEvent).detail),
		);

		$(host, "#buy").click();
		await flush(4);

		expect(fake.calls).toHaveLength(0);
		expect(blocked).toHaveBeenCalledTimes(1);
		expect(
			blocked.mock.calls[0]?.[0].missingOptions.map(
				(g: { name: string }) => g.name,
			),
		).toEqual(["Color", "Size"]);
	});

	it("holds the verb after navigating, until the page is restored from the bfcache", async () => {
		const { fake } = shopWith([
			...buyNowRoutes(),
			...buyNowRoutes(),
			// The second buy reads the remembered cart before adding to it.
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const host = await mountWithProduct(
			`<qb-product>
				<button id="buy" data-qb-action="buy-now" data-qb-success-url="/order">Köp nu</button>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);
		const product = $(host, "qb-product");
		const adds = () =>
			fake.calls.filter((c) => new URL(c.url).pathname.endsWith("/items"))
				.length;

		$(host, "#buy").click();
		await flush(8);
		expect(assign).toHaveBeenCalledTimes(1);
		expect(product.hasAttribute("buying")).toBe(true);

		$(host, "#buy").click();
		await flush(8);
		expect(adds()).toBe(1);

		restoreFromBfcache();
		expect(product.hasAttribute("buying")).toBe(false);
		$(host, "#buy").click();
		await flush(8);
		expect(adds()).toBe(2);
		restoreFromBfcache();
	});

	it("warns about the button's own attribute, and not for a blocked click", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		shopWith(buyNowRoutes());
		const host = await mountWithProduct(
			`<qb-product><button id="buy" data-qb-action="buy-now">Köp nu</button></qb-product>`,
			PRODUCT,
		);
		const noSuccessUrl = () =>
			warn.mock.calls.filter((args) => /has no /.test(String(args[0])));

		$(host, "#buy").click();
		await flush(4);
		expect(noSuccessUrl()).toHaveLength(0);

		host.remove();
		const simple = await mountWithProduct(
			`<qb-product><button id="buy" data-qb-action="buy-now">Köp nu</button></qb-product>`,
			SIMPLE_PRODUCT,
		);
		$(simple, "#buy").click();
		await flush(8);
		expect(noSuccessUrl()).toHaveLength(1);
		expect(String(noSuccessUrl()[0]?.[0])).toMatch(
			/data-qb-action="buy-now" button has no data-qb-success-url/,
		);
		restoreFromBfcache();
	});

	it("does not buy twice when the button sits inside <qb-buy-now>", async () => {
		const { fake } = shopWith(buyNowRoutes());
		const host = await mountWithProduct(
			`<qb-product>
				<qb-buy-now success-url="/order">
					<button id="buy" data-qb-action="buy-now" data-qb-success-url="/order">Köp nu</button>
				</qb-buy-now>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);

		$(host, "#buy").click();
		await flush(8);

		expect(
			fake.calls.filter((c) => new URL(c.url).pathname.endsWith("/items")),
		).toHaveLength(1);
	});
});

describe('<qb-cart> data-qb-action="clear-cart"', () => {
	it("empties the basket through the shared store", async () => {
		const { fake, shop } = shopWith([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "DELETE /v2/cart/cart-1", status: 204, text: "" },
		]);
		await shop.client.storage.set("qb_cart_id", "cart-1");
		const host = await mount(
			`<qb-cart><button id="clear" data-qb-action="clear-cart">Töm</button></qb-cart>`,
		);
		await flush();
		expect(shop.cartStore.getSnapshot().itemCount).toBe(1);

		$(host, "#clear").click();
		await flush();

		expect(fake.calls.some((c) => c.method === "DELETE")).toBe(true);
		expect(shop.cartStore.getSnapshot().itemCount).toBe(0);
		expect($(host, "qb-cart").hasAttribute("empty")).toBe(true);
		expect(await shop.client.cart.currentId()).toBeNull();
	});
});

describe('<qb-shop storefront-id="…">', () => {
	it("builds a client bound to the campaign, pricing reads for it", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_1", body: SIMPLE_PRODUCT },
		]);
		// <qb-shop> has no fetch attribute; the client it builds picks up the
		// global one at construction.
		vi.stubGlobal("fetch", fake.fetch);
		try {
			const host = await mount(
				`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" storefront-id="${SF_ID}" consent="false"></qb-shop>`,
			);
			const element = $(host, "qb-shop") as HTMLElement & {
				client: ShopkitClient | null;
			};
			expect(element.client?.storefront).toEqual({
				id: SF_ID,
				surface: "shopkit",
			});

			await element.client?.products.get(1);
			expect(
				new URL(fake.calls[0]?.url ?? "").searchParams.get("storefrontId"),
			).toBe(SF_ID);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("rebuilds when the attribute changes", async () => {
		const host = await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" consent="false"></qb-shop>`,
		);
		const element = $(host, "qb-shop") as HTMLElement & {
			client: ShopkitClient | null;
		};
		const before = element.client;
		expect(before?.storefront).toBeNull();

		element.setAttribute("storefront-id", SF_ID);
		await flush();

		expect(element.client).not.toBe(before);
		expect(element.client?.storefront?.id).toBe(SF_ID);
	});
});
