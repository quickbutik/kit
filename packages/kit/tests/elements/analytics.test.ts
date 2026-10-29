import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AnalyticsDestination,
	CommerceEvent,
} from "../../src/analytics/index.js";
import { configure, requireAmbientConsent } from "../../src/elements/index.js";
import { createMemoryStorage } from "../../src/runtime/storage.js";
import type { ShopkitClient } from "../../src/sdk/client.js";
import type { ShopTracking } from "../../src/sdk/types/shop.js";
import { frameIn, sendFromFrame, stubFrameWindow } from "../embed-helpers.js";
import { embedFrameMessageFixtures } from "../fixtures/embed-messages.fixtures.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "../helpers.js";
import {
	$,
	at,
	ensureDefined,
	flush,
	makeClient,
	mount,
	mountWithProduct,
	PRODUCT,
	resetDom,
	SIMPLE_PRODUCT,
} from "./helpers.js";

ensureDefined();

const TRACKING: ShopTracking = {
	ga4MeasurementId: "G-TEST1",
	gtmContainerId: null,
	metaPixelId: "123456",
	metaCapiEnabled: false,
};

function shopBody(tracking: ShopTracking | null = TRACKING) {
	return {
		name: "Shop",
		brand: { logo: null, color: { primary: null } },
		tracking,
	};
}

/** A destination that records what it receives and needs no consent. */
function spyDestination(id = "spy") {
	const track = vi.fn<(event: CommerceEvent) => void>();
	const destination: AnalyticsDestination = {
		id,
		requires: null,
		track: (event) => track(event),
	};
	return { destination, track };
}

function names(track: ReturnType<typeof vi.fn>): string[] {
	return track.mock.calls.map((call) => (call[0] as CommerceEvent).name);
}

function eventNamed(
	track: ReturnType<typeof vi.fn>,
	name: string,
): CommerceEvent {
	const found = track.mock.calls
		.map((call) => call[0] as CommerceEvent)
		.find((event) => event.name === name);
	if (!found) throw new Error(`no ${name} event was tracked`);
	return found;
}

/** A shop with analytics on, a spy destination and no platform lookup. */
function configureWithSpy(
	routes: FakeRoute[],
	extra: Record<string, unknown> = {},
) {
	const fake = createFakeFetch(routes);
	const { destination, track } = spyDestination();
	const shop = configure({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fake.fetch,
		currency: "SEK",
		maxRetries: 0,
		analytics: { auto: false, destinations: [destination] },
		...extra,
	});
	return { fake, shop, track };
}

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
	embedUrl: "https://platform-checkout.test/embed/42/sess-1",
};

const PATCH_ROUTE: FakeRoute = {
	match: "PATCH /v2/checkout/sessions/sess-1",
	body: { fields: {}, data: {} },
};

const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
	storeId: 42,
});

/** Enough cart reads for the store, the handoff and the resync. */
function filledCartRoutes(): FakeRoute[] {
	return [
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		PATCH_ROUTE,
		PATCH_ROUTE,
	];
}

function dataLayer(): unknown[][] {
	const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
	return (layer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

function layerIndex(command: string, target: string): number {
	return dataLayer().findIndex(
		(entry) => entry[0] === command && entry[1] === target,
	);
}

async function startedUrl(host: HTMLElement): Promise<URL> {
	const started = vi.fn();
	$(host, "qb-checkout-button").addEventListener(
		"qb:checkout-started",
		started,
	);
	$(host, "button").click();
	await flush(6);
	expect(started).toHaveBeenCalledTimes(1);
	const event = at(started.mock.calls, 0)[0] as CustomEvent<{ url: string }>;
	return new URL(event.detail.url);
}

describe("configure({ analytics })", () => {
	beforeEach(() => {
		resetDom();
		vi.spyOn(window.location, "assign").mockImplementation(() => {});
	});

	it("loads nothing before consent, then Google (default, then update) and Meta on a yes", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: shopBody() },
		]);
		configure({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		await flush();

		// Undecided: no vendor script and no Consent Mode command at all.
		expect(document.querySelector("script[data-qb-analytics]")).toBeNull();
		expect(layerIndex("consent", "default")).toBe(-1);

		requireAmbientConsent().acceptAll();
		await flush();

		// The denied default still comes first, then the update, then config,
		// all ahead of the script.
		const defaultAt = layerIndex("consent", "default");
		const updateAt = layerIndex("consent", "update");
		const configAt = layerIndex("config", "G-TEST1");
		expect(defaultAt).toBe(0);
		expect(updateAt).toBeGreaterThan(defaultAt);
		expect(configAt).toBeGreaterThan(updateAt);
		expect(at(dataLayer(), defaultAt)[2]).toMatchObject({
			analytics_storage: "denied",
			ad_storage: "denied",
		});
		expect(at(dataLayer(), updateAt)[2]).toMatchObject({
			analytics_storage: "granted",
			ad_storage: "granted",
			ad_user_data: "granted",
			ad_personalization: "granted",
		});
		expect(
			document.querySelector('script[data-qb-analytics="google"]'),
		).not.toBeNull();
		expect(
			document.querySelector('script[data-qb-analytics="meta"]'),
		).not.toBeNull();
	});

	it("loads Google before a decision only with loadBeforeConsent", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: shopBody() },
		]);
		configure({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
			analytics: { loadBeforeConsent: true },
		});
		await flush();
		expect(layerIndex("consent", "default")).toBe(0);
		expect(layerIndex("consent", "update")).toBe(-1);
		expect(
			document.querySelector('script[data-qb-analytics="google"]'),
		).not.toBeNull();
		expect(
			document.querySelector('script[data-qb-analytics="meta"]'),
		).toBeNull();
	});

	it("warns once when the shop has no tracking ids, and loads nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				body: shopBody({
					ga4MeasurementId: null,
					gtmContainerId: null,
					metaPixelId: null,
					metaCapiEnabled: false,
				}),
			},
		]);
		configure({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
			analytics: true,
		});
		await flush();

		expect(document.querySelectorAll("[data-qb-analytics]")).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("no tracking ids"),
		);
		warn.mockRestore();
	});

	it("tracks view_item once when a product mounts", async () => {
		const { track } = configureWithSpy([]);
		const host = await mountWithProduct(
			`<qb-product><h1 data-qb-text="product.name"></h1></qb-product>`,
			PRODUCT,
		);
		await flush();
		// A re-render — a variant pick — is not a second view.
		$(host, "qb-product").setAttribute("variant-id", "10");
		await flush();

		expect(names(track).filter((name) => name === "view_item")).toHaveLength(1);
		expect(eventNamed(track, "view_item").params).toMatchObject({
			currency: "SEK",
			value: 99,
			items: [{ item_id: "27", item_name: "Complex Product", price: 99 }],
		});
	});

	it("tracks search once per settled term", async () => {
		const page = { data: [PRODUCT], has_more: false, next_cursor: null };
		const { track } = configureWithSpy([
			{ match: "GET /v2/products/search", body: page },
			{ match: "GET /v2/products/search", body: page },
		]);
		const host = await mount(`
			<qb-product-list search="tee">
				<template><a data-qb-text="product.name"></a></template>
			</qb-product-list>
		`);
		await flush(6);
		// The same term again (a reload) is not a second search.
		(
			host.querySelector("qb-product-list") as HTMLElement & {
				reload(): void;
			}
		).reload();
		await flush(6);

		expect(names(track).filter((name) => name === "search")).toHaveLength(1);
		expect(eventNamed(track, "search").params).toEqual({ search_term: "tee" });
	});

	it("tracks add_to_cart from the cart store's mutation", async () => {
		const { track } = configureWithSpy([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		]);
		const host = await mountWithProduct(
			`<qb-product><qb-add-to-cart><button>Lägg i varukorgen</button></qb-add-to-cart></qb-product>`,
			SIMPLE_PRODUCT,
		);
		await flush();

		$(host, "button").click();
		await flush(6);

		const added = eventNamed(track, "add_to_cart");
		expect(added.params).toMatchObject({
			currency: "SEK",
			value: 99,
			items: [{ item_id: "27", quantity: 1, price: 99 }],
		});
	});

	it("puts the granted categories on the checkout handoff URL", async () => {
		const { shop } = configureWithSpy(filledCartRoutes());
		await shop.client.storage.set("qb_cart_id", "cart-1");
		requireAmbientConsent().acceptAll();
		const host = await mount(
			`<qb-checkout-button no-redirect success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		const url = await startedUrl(host);

		expect(url.origin + url.pathname).toBe(
			"https://checkout.test/checkout/42/sess-1",
		);
		expect(url.searchParams.get("consentCategories")).toBe(
			"analytics,marketing",
		);
	});

	it("reports an undecided shopper as nothing granted", async () => {
		const { shop } = configureWithSpy(filledCartRoutes());
		await shop.client.storage.set("qb_cart_id", "cart-1");
		const host = await mount(
			`<qb-checkout-button no-redirect success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		const url = await startedUrl(host);

		expect(url.searchParams.has("consentCategories")).toBe(true);
		expect(url.searchParams.get("consentCategories")).toBe("");
	});

	it("leaves the handoff URL alone when consent is turned off", async () => {
		const fake = createFakeFetch(filledCartRoutes());
		const shop = configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fake.fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		await shop.client.storage.set("qb_cart_id", "cart-1");
		const host = await mount(
			`<qb-checkout-button no-redirect success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		const url = await startedUrl(host);

		expect(url.toString()).toBe("https://checkout.test/checkout/42/sess-1");
		expect(url.searchParams.has("consentCategories")).toBe(false);
	});

	it("omits the parameter entirely with requireConsent: false", async () => {
		const { shop } = configureWithSpy(filledCartRoutes(), {
			analytics: {
				auto: false,
				requireConsent: false,
				destinations: [spyDestination().destination],
			},
		});
		await shop.client.storage.set("qb_cart_id", "cart-1");
		const host = await mount(
			`<qb-checkout-button no-redirect success-url="/order"><button>Kassan</button></qb-checkout-button>`,
		);
		await flush();

		const url = await startedUrl(host);

		expect(url.searchParams.has("consentCategories")).toBe(false);
	});

	it("forwards the embedded checkout's events to the hub", async () => {
		const { shop, track } = configureWithSpy(filledCartRoutes());
		await shop.client.storage.set("qb_cart_id", "cart-1");
		await shop.client.storage.set("qb_store_id", "42");
		window.history.replaceState({}, "", "/checkout");
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);

		const { frameWindow } = stubFrameWindow(frameIn(host));
		const seen = vi.fn();
		document.addEventListener("qb:checkout-event", seen);
		sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.event, { source: frameWindow });
		await flush();

		expect(seen).toHaveBeenCalledTimes(1);
		expect(eventNamed(track, "add_shipping_info").params).toMatchObject({
			currency: "SEK",
			value: 499,
		});
		document.removeEventListener("qb:checkout-event", seen);
	});

	it("destroys the previous hub when configured again", async () => {
		const first = configureWithSpy([]);
		const hub = first.shop.analytics;
		if (!hub) throw new Error("no hub");
		const destroy = vi.spyOn(hub, "destroy");

		const second = configureWithSpy([]);
		await mountWithProduct(`<qb-product></qb-product>`, PRODUCT);
		await flush();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(names(first.track)).toEqual([]);
		expect(names(second.track)).toEqual(["view_item"]);
	});

	it("leaves no vendor script behind after resetDom", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: shopBody() },
		]);
		configure({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
			analytics: true,
		});
		requireAmbientConsent().acceptAll();
		await flush();
		expect(
			document.querySelectorAll("[data-qb-analytics]").length,
		).toBeGreaterThan(0);

		resetDom();

		expect(document.querySelectorAll("[data-qb-analytics]")).toHaveLength(0);
		expect((window as unknown as { dataLayer?: unknown }).dataLayer).toBe(
			undefined,
		);
		expect((window as unknown as { fbq?: unknown }).fbq).toBe(undefined);
	});
});

describe("<qb-order-confirmation> purchase tracking", () => {
	beforeEach(resetDom);

	const CONFIRMED: FakeRoute = {
		match: "GET /v2/checkout/sessions/sess-1/confirmation",
		body: { status: "completed", orderNumber: 1042 },
	};

	const SESSION_WITH_ORDER: FakeRoute = {
		match: "GET /v2/checkout/sessions/sess-1",
		body: {
			...SESSION,
			data: {
				cart_products: {
					value: [
						{
							productId: "27",
							variantId: "10",
							name: "Tee",
							variantName: "Black / XXL",
							price: 9900,
							quantity: 2,
							imageUrl: null,
						},
					],
					resolvedAt: null,
				},
				order_total: {
					value: {
						subtotal: 19800,
						subtotalExclTax: 15840,
						subtotalInclTax: 19800,
						totalTax: 3960,
						totalDiscount: 0,
						totalShipping: 4900,
						totalPaymentFee: 0,
						total: 24700,
						currency: "SEK",
						lines: [],
					},
					resolvedAt: null,
				},
			},
			isComplete: true,
			blockingFields: [],
		},
	};

	it("tracks the purchase once, from the session's lines and total", async () => {
		// What a real thank-you page arrives with: the store id off the cart, and
		// the session the checkout remembered with its own copy of that id.
		const inputStorage = createMemoryStorage();
		await inputStorage.set("qb_store_id", "42");
		await inputStorage.set("qb_checkout_session", "sess-1");
		await inputStorage.set("qb_checkout_store", "42");
		const { track } = configureWithSpy(
			[CONFIRMED, SESSION_WITH_ORDER, CONFIRMED, SESSION_WITH_ORDER],
			{ storage: inputStorage },
		);
		const host = await mount(
			`<qb-order-confirmation session-id="sess-1"><b data-qb-text="confirmation.orderNumber"></b></qb-order-confirmation>`,
		);
		await flush(8);

		expect(names(track)).toEqual(["purchase"]);
		expect(eventNamed(track, "purchase").params).toMatchObject({
			transaction_id: "1042",
			currency: "SEK",
			value: 247,
			tax: 39.6,
			shipping: 49,
			items: [
				{
					item_id: "27",
					item_name: "Tee",
					item_variant: "Black / XXL",
					price: 99,
					quantity: 2,
				},
			],
		});
		// The platform's own dedup key, so a reload of this page — or the
		// hosted success page in the same browser — does not count it again.
		// Keyed on the numeric store id, read before the completed poll forgot it.
		expect(localStorage.getItem("qb_purchase_tracked_42_1042")).toBeTruthy();

		// A second confirmation of the same order — after the completed poll has
		// forgotten the session, as on a reload: the same key, so not again.
		host.append(
			Object.assign(document.createElement("qb-order-confirmation"), {}),
		);
		host.lastElementChild?.setAttribute("session-id", "sess-1");
		await flush(8);

		expect(names(track)).toEqual(["purchase"]);
	});

	it("does not track when told not to", async () => {
		const { fake, track } = configureWithSpy([CONFIRMED, SESSION_WITH_ORDER]);
		await mount(
			`<qb-order-confirmation session-id="sess-1" no-track-purchase></qb-order-confirmation>`,
		);
		await flush(8);

		expect(names(track)).toEqual([]);
		// It never even read the session back.
		expect(
			fake.calls.some((call) =>
				call.url.endsWith("/v2/checkout/sessions/sess-1"),
			),
		).toBe(false);
	});

	it("leaves the purchase to the frame in inline success mode", async () => {
		const { track } = configureWithSpy([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 1042, successMode: "inline" },
			},
			SESSION_WITH_ORDER,
		]);
		await mount(
			`<qb-order-confirmation session-id="sess-1"></qb-order-confirmation>`,
		);
		await flush(8);

		expect(names(track)).toEqual([]);
	});

	it("warns rather than throws when the session cannot be read back", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { track } = configureWithSpy([
			CONFIRMED,
			{ match: "GET /v2/checkout/sessions/sess-1", status: 404, body: {} },
		]);
		const host = await mount(
			`<qb-order-confirmation session-id="sess-1"></qb-order-confirmation>`,
		);
		await flush(8);

		expect($(host, "qb-order-confirmation").getAttribute("status")).toBe(
			"completed",
		);
		expect(names(track)).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("could not build a purchase event"),
		);
		warn.mockRestore();
	});
});

describe("<qb-shop analytics>", () => {
	beforeEach(resetDom);

	it("builds a hub for its own subtree and tears it down on disconnect", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: shopBody() },
		]);
		const client = makeClient(fake.fetch);
		const ready = vi.fn();
		document.addEventListener("qb:shop-ready", ready);
		const host = await mount(
			`<qb-shop analytics currency="SEK"></qb-shop>`,
			(root) => {
				const shop = root.querySelector("qb-shop") as HTMLElement & {
					client: ShopkitClient | null;
				};
				shop.client = client;
			},
		);
		await flush();

		const detail = (at(ready.mock.calls, 0)[0] as CustomEvent).detail as {
			analytics: { destroy(): void } | null;
		};
		expect(detail.analytics).not.toBeNull();
		// The subtree's hub loads the subtree's shop's tags once consent allows.
		requireAmbientConsent().acceptAll();
		await flush();
		expect(
			document.querySelector('script[data-qb-analytics="google"]'),
		).not.toBeNull();

		const hub = detail.analytics;
		if (!hub) throw new Error("no hub");
		const destroy = vi.spyOn(hub, "destroy");
		host.remove();
		await flush();

		expect(destroy).toHaveBeenCalledTimes(1);
		document.removeEventListener("qb:shop-ready", ready);
	});

	it('builds no hub with analytics="false"', async () => {
		const fake = createFakeFetch([]);
		const ready = vi.fn();
		document.addEventListener("qb:shop-ready", ready);
		await mount(`<qb-shop analytics="false"></qb-shop>`, (root) => {
			(
				root.querySelector("qb-shop") as HTMLElement & {
					client: ShopkitClient | null;
				}
			).client = makeClient(fake.fetch);
		});
		await flush();

		const detail = (at(ready.mock.calls, 0)[0] as CustomEvent).detail as {
			analytics: unknown;
		};
		expect(detail.analytics).toBeNull();
		expect(fake.calls).toHaveLength(0);
		document.removeEventListener("qb:shop-ready", ready);
	});
});
