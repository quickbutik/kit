import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { CartItem } from "../../src/sdk/types/cart.js";
import { frameIn, sendFromFrame, stubFrameWindow } from "../embed-helpers.js";
import { embedFrameMessageFixtures } from "../fixtures/embed-messages.fixtures.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	TEST_KEY,
} from "../helpers.js";
import { ensureDefined, flush, mount, resetDom } from "./helpers.js";

/**
 * These tests drive `<qb-checkout>` through `customElements`, which is NOT how
 * a merchant's page loads it. The script-tag build upgrades elements the HTML
 * parser has already produced, and happy-dom cannot reproduce that ordering —
 * so the parse-order half of this element (and the iframe's own document, which
 * never loads here) has to be verified in a real browser. What is covered here
 * is everything downstream of the upgrade: which session is created, from which
 * attributes, and what the element does with each message.
 */
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

const V2_HANDOFF = {
	...SESSION,
	checkout: "v2",
	hostedUrl: "https://checkout.test/checkout/42/sess-1",
	embedUrl: "https://platform-checkout.test/embed/42/sess-1",
};

const LEGACY_HANDOFF = {
	checkout: "legacy",
	legacyOrderUuid: "order-uuid-1",
	cartId: "cart-1",
	hostedUrl: "https://legacy.test/checkout/order-uuid-1",
	embedUrl: null,
};

/** `start()` patches a session whose cart snapshot is stale, and this one is. */
const PATCH_ROUTE = {
	match: "PATCH /v2/checkout/sessions/sess-1",
	body: { fields: {}, data: {} },
};

async function withCart(
	routes: Parameters<typeof createFakeFetch>[0],
	items: CartItem[] = [cartLine()],
	/**
	 * Sits in front of the double, for a test that needs to hold one request
	 * open — the only way to put something INSIDE the window a `mount()` is in
	 * flight, which is where the interesting cart races live.
	 */
	wrapFetch: (inner: typeof globalThis.fetch) => typeof globalThis.fetch = (
		inner,
	) => inner,
) {
	const cart = cartEnvelope({
		items,
		itemCount: items.length,
		total: 9900,
		storeId: 42,
	});
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
		// An explicitly configured checkout host, as a local or preview
		// environment sets: it wins over the platform's `embedUrl`, which is what
		// makes the assertions below deterministic.
		checkoutUrl: "https://checkout.test",
		fetch: wrapFetch(fake.fetch),
		currency: "SEK",
		maxRetries: 0,
	});
	await shop.client.storage.set("qb_cart_id", "cart-1");
	// The shop's numeric id, as every cart read leaves behind. The resume path
	// needs it without a cart in hand — a shopper coming back from a PSP has
	// reloaded the page, so the only copy left is this one.
	await shop.client.storage.set("qb_store_id", "42");
	return { fake, shop };
}

function handoffBodies(fake: ReturnType<typeof createFakeFetch>) {
	return fake.calls
		.filter((entry) => entry.url.includes("/v2/checkout/handoff"))
		.map((entry) => entry.body as Record<string, unknown>);
}

function handoffBody(fake: ReturnType<typeof createFakeFetch>) {
	return handoffBodies(fake)[0];
}

describe("<qb-checkout>", () => {
	let assign: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		resetDom();
		window.history.replaceState({}, "", "/checkout");
		assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
	});

	it("creates the session from its attributes and frames it", async () => {
		const { fake } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks" back-url="/cart" lang="sv" min-height="420"></qb-checkout>`,
		);
		await flush(6);

		expect(handoffBody(fake)).toMatchObject({
			cartId: "cart-1",
			successUrl: `${window.location.origin}/thanks`,
			backUrl: `${window.location.origin}/cart`,
			language: "sv",
			embed: {
				origin: window.location.origin,
				returnUrl: `${window.location.origin}/checkout`,
			},
		});

		const iframe = frameIn(host);
		expect(iframe.getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-1?lang=sv",
		);
		expect(iframe.getAttribute("allow")).toBe("payment");
		expect(iframe.style.height).toBe("420px");
	});

	it("paints itself in the theme the page names", async () => {
		const { fake } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		await mount(
			`<qb-checkout success-url="/thanks" theme="dark"></qb-checkout>`,
		);
		await flush(6);

		expect(handoffBody(fake)).toMatchObject({ theme: "dark" });
	});

	it("names no theme when the markup does not, so the merchant's choice applies", async () => {
		// Absent is not `light`: the platform reads "no preference" and paints
		// the checkout in the shop's own theme, which a `light` here would pin
		// shut. So the key must be missing from the body, not present and empty.
		const { fake } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		await mount(`<qb-checkout success-url="/thanks"></qb-checkout>`);
		await flush(6);

		expect(handoffBody(fake)).toMatchObject({ cartId: "cart-1" });
		expect(handoffBody(fake)).not.toHaveProperty("theme");
	});

	it("strips its own parameter out of the return URL it records", async () => {
		// A shopper who fails one redirect payment and tries another would
		// otherwise carry the first attempt's id into the second session.
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=old&x=1",
		);
		const { fake } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		// The parameter is consumed as a RESUME first, so this page creates no new
		// session — mount the element on a page where it has already been used.
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);
		const { frameWindow } = stubFrameWindow(frameIn(host));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "old" },
			{ source: frameWindow },
		);

		expect(handoffBody(fake)).toBeUndefined();
		// Only the kit's own parameter comes off; the page's stay.
		expect(window.location.search).toBe("?x=1");
	});

	it("does nothing but say so when the cart is empty", async () => {
		const { fake } = await withCart(
			[{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF }],
			[],
		);
		const empty = vi.fn();
		document.addEventListener("qb:checkout-empty", empty);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);

		expect(empty).toHaveBeenCalledTimes(1);
		expect(host.querySelector("iframe")).toBeNull();
		expect(handoffBody(fake)).toBeUndefined();
		document.removeEventListener("qb:checkout-empty", empty);
	});

	it("resumes the session a redirect payment came back with", async () => {
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		const { fake } = await withCart([]);
		const host = await mount(
			`<qb-checkout success-url="/thanks" lang="sv"></qb-checkout>`,
		);
		await flush(6);

		// No handoff: the shopper has a session, and creating a second one would
		// be a second payment.
		expect(
			fake.calls.some((call) => call.url.includes("/checkout/handoff")),
		).toBe(false);
		expect(frameIn(host).getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9?lang=sv",
		);
		// Still on the URL: the frame has not answered yet, and a reload now
		// must resume again rather than start a new checkout.
		expect(window.location.search).toBe("?qb_checkout_session=sess-9");

		const replaceState = vi.spyOn(window.history, "replaceState");
		const { frameWindow } = stubFrameWindow(frameIn(host));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		// Stripped, so a reload does not resume a session that is already spent.
		expect(window.location.search).toBe("");
		expect(window.location.pathname).toBe("/checkout");

		// A frame that reloads says `ready` again; there is nothing left to strip.
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		expect(replaceState).toHaveBeenCalledTimes(1);
		replaceState.mockRestore();
	});

	it("keeps the return parameter when the resumed frame never answers", async () => {
		// A refused document, a version mismatch: the frame is taken down and the
		// shopper sent to the hosted checkout. Had the parameter been stripped
		// on the way in, a shopper who instead hit reload would land on the
		// `mount()` branch — a fresh-looking checkout — rather than resume the
		// session they paid in.
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shop } = await withCart([]);
		const realResume = shop.client.checkout.resume.bind(shop.client.checkout);
		vi.spyOn(shop.client.checkout, "resume").mockImplementation(
			(target, sessionId, input) =>
				realResume(target, sessionId, { ...input, handshakeTimeoutMs: 500 }),
		);
		const fallback = vi.fn();
		document.addEventListener("qb:checkout-fallback", fallback);

		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);
		expect(frameIn(host)).toBeTruthy();
		await vi.waitFor(() => expect(fallback).toHaveBeenCalled(), {
			timeout: 5000,
		});

		expect(fallback).toHaveBeenCalledTimes(1);
		expect((fallback.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
			reason: "handshake-timeout",
		});
		expect(window.location.search).toBe("?qb_checkout_session=sess-9");
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-9",
		);

		document.removeEventListener("qb:checkout-fallback", fallback);
		vi.restoreAllMocks();
	});

	it("keeps the return parameter when the resume cannot start at all", async () => {
		// No store id anywhere — a return URL from a checkout older than the
		// shop parameter, in a browser that also cleared site data: `resume()`
		// rejects before a frame exists. The element reports it; the URL is left
		// exactly as the provider sent it.
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { shop } = await withCart([]);
		await shop.client.storage.remove("qb_store_id");
		const error = vi.fn();
		document.addEventListener("qb:error", error);

		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(8);

		expect(host.querySelector("iframe")).toBeNull();
		expect(host.querySelector("qb-checkout")?.getAttribute("state")).toBe(
			"error",
		);
		expect(window.location.search).toBe("?qb_checkout_session=sess-9");

		document.removeEventListener("qb:error", error);
		vi.restoreAllMocks();
	});

	it("resumes from the URL alone once the cart, and its store id, are gone", async () => {
		// The normal return leg: the order exists, so the platform has dropped
		// the cart, and with it went the kit's copy of the store id. Nothing in
		// storage; both halves of the embed path come off the URL.
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=sess-9&qb_checkout_shop=42",
		);
		const { fake, shop } = await withCart([]);
		await shop.client.storage.remove("qb_cart_id");
		await shop.client.storage.remove("qb_store_id");
		const empty = vi.fn();
		document.addEventListener("qb:checkout-empty", empty);

		const host = await mount(
			`<qb-checkout success-url="/thanks" lang="sv"></qb-checkout>`,
		);
		await flush(8);

		expect(fake.calls).toHaveLength(0);
		expect(frameIn(host).getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9?lang=sv",
		);
		expect(host.querySelector("qb-checkout")?.getAttribute("state")).not.toBe(
			"error",
		);
		// The cart store settled on nothing while the frame was up. That is the
		// expected state of a return leg, not a cart the page emptied: the frame
		// stays, and nobody is told the cart is empty.
		expect(empty).not.toHaveBeenCalled();

		const { frameWindow } = stubFrameWindow(frameIn(host));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		// Both parameters come off, once the frame has answered.
		expect(window.location.search).toBe("");
		expect(frameIn(host)).toBeTruthy();
		document.removeEventListener("qb:checkout-empty", empty);
	});

	it("strips both of its parameters on ready and leaves the page's own", async () => {
		window.history.replaceState(
			{},
			"",
			"/checkout?step=pay&qb_checkout_session=sess-9&qb_checkout_shop=42",
		);
		const { shop } = await withCart([]);
		await shop.client.storage.remove("qb_store_id");
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(8);

		const { frameWindow } = stubFrameWindow(frameIn(host));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);

		expect(window.location.search).toBe("?step=pay");
	});

	it("takes the frame down when the page empties the cart, and starts over when it fills", async () => {
		const refilled = cartEnvelope({
			id: "cart-2",
			items: [cartLine()],
			itemCount: 1,
			total: 9900,
			storeId: 42,
		});
		const { fake, shop } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
			{ match: "DELETE /v2/cart/cart-1", status: 204, body: null },
			{ match: "POST /v2/cart", status: 201, body: refilled },
			{ match: "POST /v2/cart/cart-2/items", body: refilled },
			{ match: "GET /v2/cart/cart-2", body: refilled },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					...V2_HANDOFF,
					sessionId: "sess-2",
					cartId: "cart-2",
					embedUrl: "https://platform-checkout.test/embed/42/sess-2",
				},
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-2",
				body: { fields: {}, data: {} },
			},
		]);
		const empty = vi.fn();
		document.addEventListener("qb:checkout-empty", empty);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(8);
		const first = frameIn(host);
		expect(first.getAttribute("src")).toContain("/embed/42/sess-1");
		const { frameWindow } = stubFrameWindow(first);

		// `Quickbutik.cart.clear()` from the page, with the frame up.
		await shop.cartStore.clear();
		await flush(4);

		// The frame is gone — its session names a cart that no longer exists —
		// and the page hears that there is nothing to check out.
		expect(host.querySelector("iframe")).toBeNull();
		expect(first.isConnected).toBe(false);
		expect(host.querySelector("qb-checkout")?.getAttribute("state")).toBe(
			"idle",
		);
		expect(empty).toHaveBeenCalledTimes(1);
		// And the old frame's bridge is dead: a late message must not act.
		sendFromFrame(embedFrameMessageFixtures.navigate, { source: frameWindow });
		expect(assign).not.toHaveBeenCalled();

		// Add something again: a fresh session, a fresh frame — not the old one
		// resumed, which is the stale frame this exists to prevent.
		await shop.cartStore.add({ productId: 27, variantId: 10 });
		await flush(10);

		expect(
			fake.calls.filter((call) => call.url.includes("/checkout/handoff"))
				.length,
		).toBe(2);
		expect(handoffBodies(fake)[1]).toMatchObject({ cartId: "cart-2" });
		expect(frameIn(host).getAttribute("src")).toContain("/embed/42/sess-2");
		expect(host.querySelector("qb-checkout")?.getAttribute("state")).toBe(
			"loading",
		);
		expect(empty).toHaveBeenCalledTimes(1);
		document.removeEventListener("qb:checkout-empty", empty);
	});

	describe("when the page changes the cart under a live frame", () => {
		/** The same cart with one line at quantity 2. */
		function repriced() {
			return cartEnvelope({
				items: [{ ...cartLine(), quantity: 2 }],
				itemCount: 2,
				total: 19800,
				storeId: 42,
			});
		}

		async function framed(routes: Parameters<typeof createFakeFetch>[0]) {
			const { shop } = await withCart([
				{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
				...routes,
			]);
			const host = await mount(
				`<qb-checkout success-url="/thanks"></qb-checkout>`,
			);
			await flush(8);
			const { frameWindow, posted } = stubFrameWindow(frameIn(host));
			return { shop, host, frameWindow, posted };
		}

		/** Everything the host said after the handshake's own `init`. */
		function afterHandshake(posted: () => unknown[]): unknown[] {
			return posted().filter(
				(message) => (message as { type: string }).type !== "init",
			);
		}

		const CART_UPDATED = {
			source: "qb-checkout-embed",
			v: 1,
			type: "cart-updated",
		};

		it("tells the frame exactly once, and nothing about the cart travels", async () => {
			const { shop, frameWindow, posted } = await framed([
				{ match: "PATCH /v2/cart/cart-1/items/line-1", body: repriced() },
			]);
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });

			await shop.cartStore.updateItem("line-1", 2);
			await flush(4);

			// One message for one mutation, even though the store notifies three
			// times over it (pending up, the new cart, pending down) — and it
			// carries no lines and no total. The frame re-reads the cart itself;
			// a merchant's page does not get to say what a shopper is charged.
			expect(afterHandshake(posted)).toEqual([CART_UPDATED]);
		});

		it("holds a change made before the frame answered, and sends it on ready", async () => {
			const { shop, frameWindow, posted } = await framed([
				{ match: "PATCH /v2/cart/cart-1/items/line-1", body: repriced() },
			]);

			// No `ready` yet: the frame is still loading. Nothing is said into a
			// frame that is not listening...
			await shop.cartStore.updateItem("line-1", 2);
			await flush(4);
			expect(posted()).toHaveLength(0);

			// ...but it is not lost either. The frame shows the cart as the
			// session snapshotted it and never re-reads it on its own, so without
			// this the shopper would be charged for the cart they just changed.
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			await flush(4);
			expect(afterHandshake(posted)).toEqual([CART_UPDATED]);
		});

		it("holds a change made while the session was still being created", async () => {
			// The other half of the same case: the mutation lands before there
			// is a handle at all, so the element never even consumes the
			// revision. The session's cart was snapshotted before the change and
			// the frame will not re-read it, so `ready` is still the moment to say so.
			let releaseHandoff: () => void = () => {};
			const handoff = new Promise<void>((resolve) => {
				releaseHandoff = resolve;
			});
			const { shop } = await withCart(
				[
					{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
					{ match: "PATCH /v2/cart/cart-1/items/line-1", body: repriced() },
				],
				[cartLine()],
				(inner) =>
					(async (input: RequestInfo | URL, init?: RequestInit) => {
						const request =
							input instanceof Request ? input : new Request(input, init);
						if (new URL(request.url).pathname.endsWith("/checkout/handoff")) {
							await handoff;
						}
						return inner(input, init);
					}) as typeof globalThis.fetch,
			);
			const host = await mount(
				`<qb-checkout success-url="/thanks"></qb-checkout>`,
			);
			await flush(4);
			// The handoff is still open: no session, no handle, no frame.
			expect(host.querySelector("iframe")).toBeNull();

			await shop.cartStore.updateItem("line-1", 2);
			releaseHandoff();
			await flush(8);

			const { frameWindow, posted } = stubFrameWindow(frameIn(host));
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			await flush(4);

			expect(afterHandshake(posted)).toEqual([CART_UPDATED]);
		});

		it("says nothing when the mutation failed", async () => {
			const { shop, frameWindow, posted } = await framed([
				{
					match: "PATCH /v2/cart/cart-1/items/line-1",
					status: 500,
					body: { message: "nope" },
				},
			]);
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });

			await shop.cartStore.updateItem("line-1", 2);
			await flush(4);

			// The cart on the server is the one the frame is already showing.
			expect(afterHandshake(posted)).toEqual([]);
		});

		it("says nothing for a plain refresh", async () => {
			const { shop, frameWindow, posted } = await framed([]);
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });

			await shop.cartStore.refresh();
			await flush(4);

			// Re-reading the cart is what the frame would do in ANSWER to this
			// message. Sending it for a re-read is how two sides re-read each
			// other forever.
			expect(afterHandshake(posted)).toEqual([]);
		});

		it("tears the frame down, rather than telling it, when the cart empties", async () => {
			const { shop, host, frameWindow, posted } = await framed([
				{ match: "DELETE /v2/cart/cart-1", status: 204, body: null },
			]);
			sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });

			// `clear()` is a mutation too, but the answer to a cart that is gone
			// is not "re-read it".
			await shop.cartStore.clear();
			await flush(4);

			expect(host.querySelector("iframe")).toBeNull();
			expect(afterHandshake(posted)).toEqual([]);
		});
	});

	it("leaves a completed order's frame alone when the cart store empties", async () => {
		const { shop } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
			{ match: "GET /v2/cart/cart-1", status: 404, body: { message: "gone" } },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks" confirmation="inline"></qb-checkout>`,
		);
		await flush(8);
		const { frameWindow } = stubFrameWindow(frameIn(host));
		sendFromFrame(embedFrameMessageFixtures.complete, { source: frameWindow });

		// The platform dropped the cart with the order; the page refreshes.
		await shop.cartStore.refresh();
		await flush(4);

		expect(frameIn(host)).toBeTruthy();
	});

	it("falls back to the redirect checkout on a legacy shop", async () => {
		await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: LEGACY_HANDOFF },
		]);
		const fallback = vi.fn();
		document.addEventListener("qb:checkout-fallback", fallback);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(8);

		expect(host.querySelector("iframe")).toBeNull();
		expect(fallback).toHaveBeenCalledTimes(1);
		expect((fallback.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
			reason: "legacy",
		});
		expect(assign).toHaveBeenCalledWith(
			"https://legacy.test/checkout/order-uuid-1",
		);
		document.removeEventListener("qb:checkout-fallback", fallback);
	});

	it("falls back to the redirect checkout inside a sandboxed builder preview", async () => {
		const original = Object.getOwnPropertyDescriptor(window, "top");
		Object.defineProperty(window, "top", {
			configurable: true,
			get() {
				// What a sandboxed frame's opaque origin does on any access.
				throw new Error("SecurityError: Blocked a frame from accessing top");
			},
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const fallback = vi.fn();
		document.addEventListener("qb:checkout-fallback", fallback);

		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(8);

		expect(host.querySelector("iframe")).toBeNull();
		expect((fallback.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
			reason: "no-top-navigation",
		});
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
		expect(console.warn).toHaveBeenCalledTimes(1);

		document.removeEventListener("qb:checkout-fallback", fallback);
		if (original) Object.defineProperty(window, "top", original);
		vi.restoreAllMocks();
	});

	it("falls back to the hosted checkout, not to state=error, when the frame never answers", async () => {
		// What a `frame-ancestors` refusal looks like from the host page: an
		// empty box and silence. The element's docblock promises it degrades
		// rather than strands, and this is the case that promise is for.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shop } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		// The element has no attribute for the deadline (15 s is not a merchant
		// decision), so shorten it on the way into `mount()`. Long enough that
		// the frame is still there once `boot()` has settled on a slow CI runner,
		// short enough to wait for.
		const realMount = shop.client.checkout.mount.bind(shop.client.checkout);
		vi.spyOn(shop.client.checkout, "mount").mockImplementation(
			(target, input, options) =>
				realMount(target, { ...input, handshakeTimeoutMs: 500 }, options),
		);
		const fallback = vi.fn();
		const error = vi.fn();
		document.addEventListener("qb:checkout-fallback", fallback);
		document.addEventListener("qb:checkout-error", error);

		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);
		expect(frameIn(host)).toBeTruthy();
		expect(fallback).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(fallback).toHaveBeenCalled(), {
			timeout: 5000,
		});

		const element = host.querySelector("qb-checkout") as HTMLElement;
		expect(fallback).toHaveBeenCalledTimes(1);
		expect((fallback.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
			reason: "handshake-timeout",
			url: "https://checkout.test/checkout/42/sess-1",
		});
		expect(error).not.toHaveBeenCalled();
		expect(element.getAttribute("state")).not.toBe("error");
		expect(host.querySelector("iframe")).toBeNull();
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);

		document.removeEventListener("qb:checkout-fallback", fallback);
		document.removeEventListener("qb:checkout-error", error);
		vi.restoreAllMocks();
	});

	it("re-broadcasts the frame's messages as DOM events", async () => {
		await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);

		const iframe = frameIn(host);
		const { frameWindow } = stubFrameWindow(iframe);
		const seen: string[] = [];
		for (const type of [
			"ready",
			"step",
			"event",
			"complete",
			"error",
		] as const) {
			document.addEventListener(`qb:checkout-${type}`, () => seen.push(type));
		}

		const element = host.querySelector("qb-checkout") as HTMLElement;
		sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
		expect(element.getAttribute("state")).toBe("ready");

		sendFromFrame(embedFrameMessageFixtures.step, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.event, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.error, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.complete, { source: frameWindow });

		expect(seen).toEqual(["ready", "step", "event", "error", "complete"]);
		// `complete` with the default confirmation leaves the page for the
		// confirmed order — the same URL `<qb-checkout-button>` would have landed
		// on, which is `success-url`'s ORIGIN plus the order's own path.
		expect(assign).toHaveBeenCalledWith(
			embedFrameMessageFixtures.complete.successUrl,
		);
	});

	it("keeps the shopper on the page with confirmation=inline", async () => {
		await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks" confirmation="inline"></qb-checkout>`,
		);
		await flush(6);
		const { frameWindow } = stubFrameWindow(frameIn(host));

		sendFromFrame(embedFrameMessageFixtures.complete, { source: frameWindow });

		expect(assign).not.toHaveBeenCalled();
	});

	it("tears the frame down when it leaves the document", async () => {
		await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);
		const element = host.querySelector("qb-checkout") as HTMLElement;
		const iframe = frameIn(host);
		const { frameWindow } = stubFrameWindow(iframe);

		element.remove();

		expect(iframe.isConnected).toBe(false);
		// And the bridge's window listener went with it: a late message from a
		// frame that is gone must not navigate the page.
		sendFromFrame(embedFrameMessageFixtures.navigate, { source: frameWindow });
		expect(assign).not.toHaveBeenCalled();
	});

	it("resumes the same session when it is put back in the document", async () => {
		const { fake } = await withCart([
			{ match: "POST /v2/checkout/handoff", status: 201, body: V2_HANDOFF },
		]);
		const host = await mount(
			`<qb-checkout success-url="/thanks"></qb-checkout>`,
		);
		await flush(6);
		const element = host.querySelector("qb-checkout") as HTMLElement;
		expect(frameIn(host).getAttribute("src")).toContain("/embed/42/sess-1");

		// Ordinary DOM churn: a list reorder, a portal move, a tab that detaches
		// its panel, React StrictMode's dev remount.
		element.remove();
		host.append(element);
		await flush(6);

		// A frame again rather than an empty box — and the SAME session: a second
		// handoff here would be a second payment for a shopper who may already
		// have paid.
		expect(
			fake.calls.filter((call) => call.url.includes("/checkout/handoff"))
				.length,
		).toBe(1);
		expect(frameIn(host).getAttribute("src")).toContain("/embed/42/sess-1");
	});
});
