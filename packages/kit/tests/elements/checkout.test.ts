import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { CartItem } from "../../src/sdk/types/cart.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	at,
	ensureDefined,
	flush,
	mount,
	resetDom,
	text,
} from "./helpers.js";

ensureDefined();

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

const HANDOFF = {
	...SESSION,
	checkout: "v2",
	hostedUrl: "https://checkout.test/checkout/42/sess-1",
};

/**
 * `start()` re-checks the session's cart snapshot against the live cart and
 * patches when they disagree, so a handoff route on its own is not enough to
 * drive the flow to a navigation.
 */
const PATCH_ROUTE = {
	match: "PATCH /v2/checkout/sessions/sess-1",
	body: { fields: {}, data: {} },
};

function line(): CartItem {
	return {
		id: "line-1",
		productId: 27,
		variantId: 10,
		quantity: 1,
		productTitle: "Tee",
		variantName: null,
		sku: "tee",
		imageUrl: null,
		unitPrice: 9900,
		unitPriceExclTax: 7920,
		unitPriceInclTax: 9900,
		compareAtPrice: null,
		taxRate: 25,
		taxAmount: 1980,
		discountAmount: 0,
		lineTotal: 9900,
		lineTotalTax: 1980,
		lineTotalExclTax: 7920,
		lineTotalInclTax: 9900,
		available: true,
	};
}

async function withFilledCart(routes: Parameters<typeof createFakeFetch>[0]) {
	const cart = cartEnvelope({ items: [line()], itemCount: 1, total: 9900 });
	// Several: the store loads the cart, and `checkout.start()` reads it again to
	// resolve the store id for the handoff URL.
	const fake = createFakeFetch([
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		...routes,
		PATCH_ROUTE,
		PATCH_ROUTE,
	]);
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
	await shop.client.storage.set("qb_cart_id", "cart-1");
	return { fake, shop };
}

describe("<qb-checkout-button>", () => {
	let assign: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		resetDom();
		assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
	});

	it("starts the session and navigates to the hosted checkout", async () => {
		await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button success-url="/order"><button>Till kassan</button></qb-checkout-button>`,
		);
		await flush();

		$(host, "button").click();
		await flush(6);

		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
	});

	it("resolves a relative success-url against the current origin", async () => {
		const { fake } = await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();
		$(host, "button").click();
		await flush();

		const handoff = fake.calls.find((call) => call.url.endsWith("/handoff"));
		expect(handoff?.body).toMatchObject({
			successUrl: `${window.location.origin}/order`,
		});
	});

	it("sends the theme the markup names, and none when it names none", async () => {
		const { fake } = await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button success-url="/order" theme="dark"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();
		$(host, "button").click();
		await flush(6);

		const handoff = fake.calls.find((call) => call.url.endsWith("/handoff"));
		expect(handoff?.body).toMatchObject({ theme: "dark" });
	});

	it("drops a theme that is not one of the two, rather than losing the checkout", async () => {
		// Absent is not `light` — it means "follow the shop's own theme" — so a
		// value the platform would 400 on is dropped back to that, loudly, and
		// the shopper still gets a checkout.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { fake } = await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button success-url="/order" theme="midnight"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();
		$(host, "button").click();
		await flush(6);

		const handoff = fake.calls.find((call) => call.url.endsWith("/handoff"));
		expect(handoff?.body).not.toHaveProperty("theme");
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('theme="midnight"'),
		);
		warn.mockRestore();
	});

	it("disables the button and marks itself empty while the cart is empty", async () => {
		const fake = createFakeFetch([]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount(
			`<qb-checkout-button><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		expect($(host, "qb-checkout-button").hasAttribute("empty")).toBe(true);
		expect(($(host, "button") as HTMLButtonElement).disabled).toBe(true);

		$(host, "button").click();
		await flush();
		expect(fake.calls).toHaveLength(0);
	});

	it("emits the handoff without navigating when told not to redirect", async () => {
		await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button no-redirect success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		const started = vi.fn();
		$(host, "qb-checkout-button").addEventListener(
			"qb:checkout-started",
			started,
		);
		$(host, "button").click();
		await flush(6);

		expect(assign).not.toHaveBeenCalled();
		expect(started).toHaveBeenCalled();
		const event = at(started.mock.calls, 0)[0] as CustomEvent;
		expect(event.detail.url).toBe("https://checkout.test/checkout/42/sess-1");
	});

	it("does not start a second session on a double click", async () => {
		const { fake } = await withFilledCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout-button success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		$(host, "button").click();
		$(host, "button").click();
		await flush();

		expect(
			fake.calls.filter((call) => call.url.endsWith("/handoff")),
		).toHaveLength(1);
	});
});

describe("<qb-order-confirmation>", () => {
	beforeEach(resetDom);

	it("polls until the order exists and exposes the number", async () => {
		// One response, already terminal. The backoff between polls is
		// `pollConfirmation`'s business and is covered in tests/checkout.test.ts;
		// what this asserts is that the element renders whatever it settles on.
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 1042 },
			},
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});

		const host = await mount(`
			<qb-order-confirmation session-id="sess-1">
				<p id="wait" data-qb-show="confirmation.loading">Skapar din order…</p>
				<p id="done" data-qb-show="confirmation.completed">
					Tack! <b data-qb-text="confirmation.orderNumber"></b>
				</p>
			</qb-order-confirmation>
		`);
		await flush(6);

		const element = $(host, "qb-order-confirmation");
		expect(element.getAttribute("status")).toBe("completed");
		expect(text(host, "#done b")).toBe("1042");
		expect($(host, "#wait").hidden).toBe(true);
		expect($(host, "#done").hidden).toBe(false);
	});

	it("reads the session id from the return URL when given none", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/from-url/confirmation",
				body: { status: "completed", orderNumber: 7 },
			},
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const original = window.location.search;
		Object.defineProperty(window.location, "search", {
			value: "?session_id=from-url",
			configurable: true,
		});

		const host = await mount(
			`<qb-order-confirmation><b data-qb-text="confirmation.orderNumber"></b></qb-order-confirmation>`,
		);
		await flush(6);

		expect(text(host, "b")).toBe("7");
		Object.defineProperty(window.location, "search", {
			value: original,
			configurable: true,
		});
	});

	it("reflects a failed payment as a status attribute and a scope flag", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-2/confirmation",
				body: { status: "failed" },
			},
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});

		const host = await mount(`
			<qb-order-confirmation session-id="sess-2">
				<p id="bad" data-qb-show="confirmation.failed">Betalningen gick inte igenom.</p>
			</qb-order-confirmation>
		`);
		await flush(6);

		expect($(host, "qb-order-confirmation").getAttribute("status")).toBe(
			"failed",
		);
		expect($(host, "#bad").hidden).toBe(false);
	});
});
