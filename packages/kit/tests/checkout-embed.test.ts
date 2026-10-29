import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import {
	CHECKOUT_SESSION_PARAM,
	CHECKOUT_SHOP_PARAM,
	consumeReturnedSessionId,
	readReturnedCheckout,
	readReturnedSessionId,
	stripReturnedSessionId,
} from "../src/sdk/embed/return-leg.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

const PLATFORM_EMBED_URL = "https://platform-checkout.test/embed/42/sess-1";
const PLATFORM_HOSTED_URL = "https://platform-checkout.test/checkout/42/sess-1";

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

function handoff(overrides: Record<string, unknown> = {}) {
	return {
		...SESSION,
		checkout: "v2",
		hostedUrl: PLATFORM_HOSTED_URL,
		embedUrl: PLATFORM_EMBED_URL,
		...overrides,
	};
}

/** A cart, its handoff, and the patch `start()` makes for a stale snapshot. */
function routes(handoffBody: Record<string, unknown>) {
	const cart = cartEnvelope({ storeId: 42 });
	return [
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "POST /v2/checkout/handoff", status: 201, body: handoffBody },
	];
}

function makeClient(
	fetchImpl: typeof globalThis.fetch,
	checkoutUrl?: string,
	storage = createMemoryStorage(),
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		...(checkoutUrl ? { checkoutUrl } : {}),
		fetch: fetchImpl,
		storage,
		maxRetries: 0,
	});
}

/**
 * A client with a cart already remembered, so `start()` reads that cart rather
 * than creating one.
 */
async function ready(
	handoffBody: Record<string, unknown> = handoff(),
	checkoutUrl?: string,
) {
	const storage = createMemoryStorage();
	await storage.set("qb_cart_id", "cart-1");
	const fake = createFakeFetch(routes(handoffBody));
	return { fake, shopkit: makeClient(fake.fetch, checkoutUrl, storage) };
}

function container(): HTMLElement {
	// Detached on purpose: happy-dom fetches a connected iframe's src, and
	// nothing here needs the frame's document (see tests/embed-helpers.ts).
	return document.createElement("div");
}

describe("embedUrl()", () => {
	it("builds /embed/{storeId}/{sessionId}", () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		expect(
			shopkit.checkout.embedUrl({ sessionId: "sess-1", storeId: 101928 }),
		).toBe("https://checkout.test/embed/101928/sess-1");
	});

	it("carries the language", () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		expect(
			shopkit.checkout.embedUrl({
				sessionId: "sess-1",
				storeId: 42,
				language: "sv",
			}),
		).toBe("https://checkout.test/embed/42/sess-1?lang=sv");
	});

	it("refuses the key's shop prefix, which the checkout does not recognise", () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		expect(() =>
			shopkit.checkout.embedUrl({ sessionId: "s", storeId: "shop123" }),
		).toThrow(ShopkitConfigError);
	});

	it("refuses to guess when no store id is known", () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		expect(() => shopkit.checkout.embedUrl("sess-1")).toThrow(
			/numeric store id/,
		);
	});
});

describe("start() with an embed block", () => {
	it("sends it and surfaces the platform's embed URL", async () => {
		const { fake, shopkit } = await ready();

		const result = await shopkit.checkout.start({
			successUrl: "https://shop.test/thanks",
			embed: {
				origin: "https://shop.test",
				returnUrl: "https://shop.test/checkout",
			},
		});

		const call = fake.calls.find((entry) => entry.url.includes("/handoff"));
		expect(call?.body).toMatchObject({
			embed: {
				origin: "https://shop.test",
				returnUrl: "https://shop.test/checkout",
			},
		});
		expect(result.embedUrl).toBe(PLATFORM_EMBED_URL);
	});

	it("surfaces no embed URL when none was asked for", async () => {
		const { shopkit } = await ready();

		const result = await shopkit.checkout.start({
			successUrl: "https://shop.test/thanks",
		});

		expect(result.embedUrl).toBeNull();
	});
});

describe("mount()", () => {
	let assign: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it("records this page as the embed origin and return URL", async () => {
		const { fake, shopkit } = await ready();
		const handle = await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
		});

		const call = fake.calls.find((entry) => entry.url.includes("/handoff"));
		expect(call?.body).toMatchObject({
			embed: {
				origin: window.location.origin,
				returnUrl: window.location.href,
			},
		});
		expect(handle.state).toBe("embed");
		expect(handle.sessionId).toBe("sess-1");
	});

	it("frames the URL the platform returned", async () => {
		const { shopkit } = await ready();
		const target = container();
		await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
		});

		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			PLATFORM_EMBED_URL,
		);
	});

	it("lets an explicitly configured checkout host win", async () => {
		// What a local or preview environment or a self-hosted checkout relies
		// on; the same precedence `start()` gives the hosted URL.
		const { shopkit } = await ready(handoff(), "https://checkout.rig.test");
		const target = container();
		await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
			language: "sv",
		});

		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			"https://checkout.rig.test/embed/42/sess-1?lang=sv",
		);
	});

	it("falls back to the redirect checkout when the platform has no embed URL", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shopkit } = await ready(handoff({ embedUrl: null }));
		const target = container();
		const handle = await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
		});
		const seen = vi.fn();
		handle.on("fallback", seen);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(handle.state).toBe("fallback");
		expect(target.querySelector("iframe")).toBeNull();
		expect(seen).toHaveBeenCalledWith({
			reason: "no-embed-url",
			url: PLATFORM_HOSTED_URL,
		});
		expect(assign).toHaveBeenCalledWith(PLATFORM_HOSTED_URL);
		// The explanation is a console warning, not an exception: a shop on an
		// older platform is a configuration, not a bug in the page.
		expect(console.warn).toHaveBeenCalledTimes(1);
	});

	it("treats an api-core that predates the field the same way", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const body = handoff();
		delete (body as Record<string, unknown>).embedUrl;
		const { shopkit } = await ready(body);
		const handle = await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
		});

		expect(handle.state).toBe("fallback");
	});

	it("falls back on a legacy shop without throwing", async () => {
		const { shopkit } = await ready({
			checkout: "legacy",
			legacyOrderUuid: "order-1",
			cartId: "cart-1",
			hostedUrl: "https://legacy.test/checkout/order-1",
			embedUrl: null,
		});
		const handle = await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
		});
		const seen = vi.fn();
		handle.on("fallback", seen);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(seen).toHaveBeenCalledWith({
			reason: "legacy",
			url: "https://legacy.test/checkout/order-1",
		});
		expect(assign).toHaveBeenCalledWith("https://legacy.test/checkout/order-1");
	});

	it("stays put when the caller wants to render the fallback itself", async () => {
		const { shopkit } = await ready({
			checkout: "legacy",
			legacyOrderUuid: "order-1",
			cartId: "cart-1",
			hostedUrl: "https://legacy.test/checkout/order-1",
			embedUrl: null,
		});
		const handle = await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
			fallbackRedirect: false,
		});
		handle.on("fallback", () => undefined);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(assign).not.toHaveBeenCalled();
	});

	it("names the selector it could not find", async () => {
		const shopkit = makeClient(createFakeFetch([]).fetch);
		await expect(
			shopkit.checkout.mount("#nowhere", {
				successUrl: "https://shop.test/thanks",
			}),
		).rejects.toThrow(/#nowhere/);
	});

	it("replaces the checkout already in a container instead of stacking a second one", async () => {
		// The idempotent handoff means the second call is the same session, not a
		// second order; what it must not be is a second frame. The first handle
		// goes, timer and all — the deadline below would otherwise fire a
		// fallback redirect from a frame nobody can see.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([...routes(handoff()), ...routes(handoff())]);
		const shopkit = makeClient(fake.fetch, undefined, storage);
		const target = container();

		const first = await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
			handshakeTimeoutMs: 10,
		});
		const firstFallback = vi.fn();
		first.on("fallback", firstFallback);
		const second = await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
		});

		// The container is detached here (see `container()`), so parentage is
		// the question, not `isConnected`.
		expect(target.querySelectorAll("iframe")).toHaveLength(1);
		expect(first.iframe).not.toBeNull();
		expect(first.iframe?.parentElement).toBeNull();
		expect(second.iframe?.parentElement).toBe(target);
		expect(second.sessionId).toBe(first.sessionId);

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(firstFallback).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});

	it("falls back to the hosted checkout for the same session when the frame never answers", async () => {
		// The URL the redirect checkout would have used was in hand the whole
		// time; a frame that stays silent (refused by `frame-ancestors`, most
		// often) must not throw it away and leave the shopper an empty box.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shopkit } = await ready();
		const target = container();
		const handle = await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
			handshakeTimeoutMs: 10,
		});
		const fallback = vi.fn();
		const error = vi.fn();
		handle.on("fallback", fallback);
		handle.on("error", error);
		expect(handle.state).toBe("embed");

		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(fallback).toHaveBeenCalledWith({
			reason: "handshake-timeout",
			url: PLATFORM_HOSTED_URL,
		});
		expect(error).not.toHaveBeenCalled();
		expect(handle.state).toBe("fallback");
		expect(target.querySelector("iframe")).toBeNull();
		expect(assign).toHaveBeenCalledWith(PLATFORM_HOSTED_URL);
	});

	it("respects fallbackRedirect: false for a frame that never answers too", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shopkit } = await ready();
		const target = container();
		const handle = await shopkit.checkout.mount(target, {
			successUrl: "https://shop.test/thanks",
			handshakeTimeoutMs: 10,
			fallbackRedirect: false,
		});
		const fallback = vi.fn();
		handle.on("fallback", fallback);

		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(fallback).toHaveBeenCalledTimes(1);
		expect(target.querySelector("iframe")).toBeNull();
		expect(assign).not.toHaveBeenCalled();
	});
});

describe("resume()", () => {
	it("frames an existing session with no handoff call", async () => {
		const storage = createMemoryStorage();
		const fake = createFakeFetch([]);
		const shopkit = makeClient(fake.fetch, "https://checkout.test", storage);
		await storage.set("qb_store_id", "42");

		const target = container();
		const handle = await shopkit.checkout.resume(target, "sess-9", {
			language: "sv",
		});

		expect(fake.calls).toHaveLength(0);
		expect(handle.sessionId).toBe("sess-9");
		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9?lang=sv",
		);
	});

	it("explains the stranded-shopper case when no store id is known", async () => {
		// The one place the remembered id can be missing: a shopper back from a
		// payment redirect whose browser cleared site data in between. They have
		// probably paid, so the message has to say that rather than "pass an id".
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);

		await expect(
			shopkit.checkout.resume(container(), "sess-9"),
		).rejects.toThrow(/payment redirect[\s\S]*storeId/);
	});

	it("takes an explicit store id when storage has none", async () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		const target = container();
		await shopkit.checkout.resume(target, "sess-9", { storeId: 42 });

		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9",
		);
	});

	it("remembers the session for the thank-you page", async () => {
		const storage = createMemoryStorage();
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
			storage,
		);
		await shopkit.checkout.resume(container(), "sess-9", { storeId: 42 });

		expect(await shopkit.checkout.currentSessionId()).toBe("sess-9");
	});

	describe("when the resumed frame never answers", () => {
		let assign: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			assign = vi.fn();
			vi.spyOn(window.location, "assign").mockImplementation(
				assign as unknown as (url: string | URL) => void,
			);
			vi.spyOn(console, "warn").mockImplementation(() => {});
		});

		afterEach(() => vi.restoreAllMocks());

		it("falls back to the hosted checkout of THAT session", async () => {
			// The shopper coming back from Swish has paid, or is about to. The
			// hosted URL is built from the same store id, session id and language
			// as the embed URL, so it exists whenever the frame did — and it lands
			// on the same session's confirmation, not on a new checkout.
			const shopkit = makeClient(
				createFakeFetch([]).fetch,
				"https://checkout.test",
			);
			const target = container();
			const handle = await shopkit.checkout.resume(target, "sess-9", {
				storeId: 42,
				language: "sv",
				handshakeTimeoutMs: 10,
			});
			const fallback = vi.fn();
			handle.on("fallback", fallback);

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(fallback).toHaveBeenCalledWith({
				reason: "handshake-timeout",
				url: "https://checkout.test/checkout/42/sess-9?lang=sv",
			});
			expect(target.querySelector("iframe")).toBeNull();
			expect(assign).toHaveBeenCalledWith(
				"https://checkout.test/checkout/42/sess-9?lang=sv",
			);
		});

		it("takes fallbackRedirect: false on resume as well", async () => {
			const shopkit = makeClient(
				createFakeFetch([]).fetch,
				"https://checkout.test",
			);
			const handle = await shopkit.checkout.resume(container(), "sess-9", {
				storeId: 42,
				handshakeTimeoutMs: 10,
				fallbackRedirect: false,
			});
			const fallback = vi.fn();
			handle.on("fallback", fallback);

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(fallback).toHaveBeenCalledTimes(1);
			expect(handle.state).toBe("fallback");
			expect(assign).not.toHaveBeenCalled();
		});
	});
});

describe("the return leg's parameters", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/checkout");
	});

	it("reads the session and the shop off this page's URL", () => {
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=sess-9&qb_checkout_shop=42",
		);

		expect(readReturnedCheckout()).toEqual({
			sessionId: "sess-9",
			storeId: "42",
		});
		expect(readReturnedSessionId()).toBe("sess-9");
	});

	it("is not a return leg without the session, whatever else is there", () => {
		window.history.replaceState({}, "", "/checkout?qb_checkout_shop=42");
		expect(readReturnedCheckout()).toBeNull();
		expect(readReturnedSessionId()).toBeNull();
	});

	it("treats a shop id that is not a number as not carried", () => {
		// A query string is writable by anyone, and the key's prefix is the
		// classic wrong value. Better to fall back to storage than to build a
		// URL the checkout answers with "we couldn't find shop123".
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=sess-9&qb_checkout_shop=shop123",
		);
		expect(readReturnedCheckout()).toEqual({
			sessionId: "sess-9",
			storeId: null,
		});
	});

	it("reads a URL it is handed, for a server that has no window", () => {
		expect(
			readReturnedCheckout(
				"https://shop.test/checkout?qb_checkout_session=sess-9&qb_checkout_shop=42",
			),
		).toEqual({ sessionId: "sess-9", storeId: "42" });
		expect(
			readReturnedCheckout(new URL("https://shop.test/checkout?x=1")),
		).toBeNull();
		expect(readReturnedCheckout("/checkout?qb_checkout_session=s")).toEqual({
			sessionId: "s",
			storeId: null,
		});
		expect(readReturnedCheckout("::::")).toBeNull();
		// This page's URL is never consulted when one is given.
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=here");
		expect(readReturnedCheckout("https://shop.test/other")).toBeNull();
	});

	it("strips both of its parameters and nothing else", () => {
		window.history.replaceState(
			{},
			"",
			"/checkout?a=1&qb_checkout_session=sess-9&qb_checkout_shop=42&b=2#top",
		);

		stripReturnedSessionId();

		expect(window.location.search).toBe("?a=1&b=2");
		expect(window.location.hash).toBe("#top");
		expect(window.location.pathname).toBe("/checkout");
	});

	it("strips a stray shop parameter even without a session", () => {
		window.history.replaceState({}, "", "/checkout?qb_checkout_shop=42&x=1");
		stripReturnedSessionId();
		expect(window.location.search).toBe("?x=1");
	});

	it("is a no-op when neither parameter is present", () => {
		window.history.replaceState({}, "", "/checkout?x=1");
		const replaceState = vi.spyOn(window.history, "replaceState");
		stripReturnedSessionId();
		expect(replaceState).not.toHaveBeenCalled();
		replaceState.mockRestore();
	});

	it("consumes the session id and strips both parameters", () => {
		window.history.replaceState(
			{},
			"",
			`/checkout?${CHECKOUT_SESSION_PARAM}=sess-9&${CHECKOUT_SHOP_PARAM}=42`,
		);
		expect(consumeReturnedSessionId()).toBe("sess-9");
		expect(window.location.search).toBe("");
		expect(consumeReturnedSessionId()).toBeNull();
	});
});

describe("the store id a resume falls back to", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/checkout");
	});

	afterEach(() => vi.restoreAllMocks());

	it("takes the URL's shop id first, so no storage is needed", async () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		const target = container();

		await shopkit.checkout.resume(target, "sess-9", { storeId: "42" });

		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9",
		);
	});

	it("survives the cart being forgotten, from the copy kept with the session", async () => {
		// The platform drops the cart the moment the order is created, which on a
		// Klarna or Swish return is normally BEFORE the shopper is back. The next
		// cart read 404s and the kit forgets the cart. The store id next to it is
		// kept (a thank-you page keys its purchase on it), so the session's copy
		// is isolated by hand below: it is what covers a storage whose cart copy
		// has expired, or that never saw a cart read at all.
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			// One cart read for `mount()`; the next one finds the cart gone.
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
			{ match: "POST /v2/checkout/handoff", status: 201, body: handoff() },
			{ match: "GET /v2/cart/cart-1", status: 404, body: { message: "gone" } },
		]);
		const shopkit = makeClient(fake.fetch, "https://checkout.test", storage);
		await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
		});
		expect(await storage.get("qb_checkout_store")).toBe("42");

		expect(await shopkit.cart.current()).toBeNull();
		expect(await storage.get("qb_store_id")).toBe("42");
		expect(await storage.get("qb_checkout_store")).toBe("42");
		await storage.remove("qb_store_id");

		// A fresh client, so nothing is answered from the first one's memory.
		const fresh = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
			storage,
		);
		const target = container();
		await fresh.checkout.resume(target, "sess-1");
		expect(target.querySelector("iframe")?.getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-1",
		);
	});

	it("is read from storage on a fresh page, not just from memory", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_checkout_store", "42");
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
			storage,
		);

		expect(shopkit.checkout.embedUrl("sess-9")).toBe(
			"https://checkout.test/embed/42/sess-9",
		);
	});

	it("is remembered by a resume too, and forgotten with the session", async () => {
		const storage = createMemoryStorage();
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
			storage,
		);

		await shopkit.checkout.resume(container(), "sess-9", { storeId: 42 });
		expect(await storage.get("qb_checkout_store")).toBe("42");

		await shopkit.checkout.finalize();
		expect(await storage.get("qb_checkout_store")).toBeNull();
		expect(await storage.get("qb_checkout_session")).toBeNull();
	});

	it("finalize forgets the cart and the session but keeps the shop's store id", async () => {
		// The thank-you page keys the purchase event on this id, and a reload of
		// that page — after the completed poll — must build the same key.
		const inputStorage = createMemoryStorage();
		await inputStorage.set("qb_cart_id", "cart-1");
		await inputStorage.set("qb_store_id", "42");
		await inputStorage.set("qb_checkout_session", "sess-9");
		await inputStorage.set("qb_checkout_store", "42");
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
			inputStorage,
		);

		await shopkit.checkout.finalize();

		expect(await inputStorage.get("qb_cart_id")).toBeNull();
		expect(await inputStorage.get("qb_checkout_session")).toBeNull();
		expect(await inputStorage.get("qb_checkout_store")).toBeNull();
		expect(await inputStorage.get("qb_store_id")).toBe("42");
		expect(shopkit.checkout.rememberedStoreId()).toBe("42");
	});

	it("still names the stranded-shopper case when nothing carries the id", async () => {
		const shopkit = makeClient(
			createFakeFetch([]).fetch,
			"https://checkout.test",
		);
		await expect(
			shopkit.checkout.resume(container(), "sess-9"),
		).rejects.toThrow(/qb_checkout_shop[\s\S]*PAID/);
	});

	it("keeps both parameters out of the return URL it records", async () => {
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=old&qb_checkout_shop=42&x=1",
		);
		const { fake, shopkit } = await ready();
		await shopkit.checkout.mount(container(), {
			successUrl: "https://shop.test/thanks",
		});

		const call = fake.calls.find((entry) => entry.url.includes("/handoff"));
		expect(
			(call?.body as { embed: { returnUrl: string } }).embed.returnUrl,
		).toBe(`${window.location.origin}/checkout?x=1`);
	});
});
