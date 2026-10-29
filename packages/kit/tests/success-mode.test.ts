import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import type { StartCheckoutInput } from "../src/sdk/resources/checkout.js";
import {
	type CreateSessionInput,
	type SessionConfirmation,
	SUCCESS_MODES,
	type SuccessMode,
} from "../src/sdk/types/checkout.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

function client(fetchImpl: typeof globalThis.fetch) {
	const storage = createMemoryStorage();
	return {
		shopkit: createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fetchImpl,
			storage,
			maxRetries: 0,
		}),
		storage,
	};
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
	hostedUrl: "https://platform-checkout.test/checkout/42/sess-1",
};

describe("successMode on the wire", () => {
	it("is absent from the session body when the caller did not set it", async () => {
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
	});

	it("is sent when set — even the default, since the caller named it", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: { ...SESSION, successMode: "redirect" },
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
			successMode: "redirect",
		});

		expect(fake.calls[0]?.body).toMatchObject({ successMode: "redirect" });
		expect(session.successMode).toBe("redirect");
	});

	it("inline without a successUrl sends no successUrl key at all", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: { ...SESSION, successUrl: null, successMode: "inline" },
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		// Compiles without successUrl: the field is optional on the type, and
		// only the runtime rule (below) insists on it for redirect mode.
		const input: CreateSessionInput = {
			cartId: "cart-1",
			successMode: "inline",
			backUrl: "https://myshop.test/campaign",
		};
		await shopkit.checkout.createSession(input);

		expect(fake.calls[0]?.body).toEqual({
			cartId: "cart-1",
			successMode: "inline",
			backUrl: "https://myshop.test/campaign",
		});
		expect(fake.calls[0]?.body).not.toHaveProperty("successUrl");
	});

	it("inline WITH a successUrl still forwards it, trimmed", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successMode: "inline",
			successUrl: "  https://myshop.test/order ",
		});

		expect(fake.calls[0]?.body).toMatchObject({
			successMode: "inline",
			successUrl: "https://myshop.test/order",
		});
	});

	it("drops a blank successUrl in inline mode rather than sending an empty string", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/checkout/sessions", status: 201, body: SESSION },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.createSession({
			cartId: "cart-1",
			successMode: "inline",
			successUrl: "   ",
		});

		expect(fake.calls[0]?.body).not.toHaveProperty("successUrl");
	});

	it("reaches the handoff body from start(), and only when set", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: { ...HANDOFF, successMode: "inline" },
			},
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.start({ successUrl: "https://myshop.test/order" });
		expect(fake.calls[1]?.body).toEqual({
			cartId: "cart-1",
			successUrl: "https://myshop.test/order",
		});

		const inline: StartCheckoutInput = {
			cartId: "cart-1",
			successMode: "inline",
			backUrl: "https://myshop.test/campaign",
		};
		const result = await shopkit.checkout.start(inline);
		expect(fake.calls[3]?.body).toEqual({
			cartId: "cart-1",
			successMode: "inline",
			backUrl: "https://myshop.test/campaign",
		});
		expect(result.session?.successMode).toBe("inline");
		// The URL still comes back: inline changes how the checkout ENDS, not how
		// the shopper gets there.
		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
	});

	it("trims the successUrl it validated before sending it", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		]);
		const { shopkit } = client(fake.fetch);

		await shopkit.checkout.start({
			successUrl: " https://myshop.test/order\n",
		});

		expect(fake.calls[1]?.body).toMatchObject({
			successUrl: "https://myshop.test/order",
		});
	});
});

describe("a null successUrl on the response", () => {
	// An inline session created without a successUrl is answered with
	// `successUrl: null` by create, get and handoff alike. The kit reads none
	// of them for navigation, so the null must simply survive the round trip
	// and be typed as such.
	const INLINE_SNAPSHOT = {
		cartId: "cart-1",
		successUrl: null,
		cancelUrl: null,
		backUrl: null,
		language: null,
		origin: null,
		successMode: "inline",
		fields: {},
		data: {},
		isComplete: false,
		blockingFields: [],
	};

	it("round-trips through createSession() and getSession()", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/checkout/sessions",
				status: 201,
				body: { ...SESSION, successUrl: null, successMode: "inline" },
			},
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "GET /v2/checkout/sessions/sess-1", body: INLINE_SNAPSHOT },
		]);
		const { shopkit } = client(fake.fetch);

		const session = await shopkit.checkout.createSession({
			cartId: "cart-1",
			successMode: "inline",
		});
		const successUrl: string | null = session.successUrl;
		expect(successUrl).toBeNull();
		expect(session.successMode).toBe("inline");

		const snapshot = await shopkit.checkout.getSession("sess-1");
		expect(snapshot).not.toBeNull();
		const snapshotUrl: string | null = snapshot?.successUrl ?? null;
		expect(snapshotUrl).toBeNull();
		expect(snapshot?.successMode).toBe("inline");
	});

	it("round-trips through start() and still yields a hosted URL", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: { ...HANDOFF, successUrl: null, successMode: "inline" },
			},
		]);
		const { shopkit } = client(fake.fetch);

		const result = await shopkit.checkout.start({
			cartId: "cart-1",
			successMode: "inline",
			backUrl: "https://myshop.test/campaign",
		});

		expect(result.session?.successUrl).toBeNull();
		expect(result.session?.successMode).toBe("inline");
		expect(result.url).toBe("https://checkout.test/checkout/42/sess-1");
	});
});

describe("the successUrl rule", () => {
	it("redirect mode without a successUrl throws by name before any request", async () => {
		const fake = createFakeFetch([]);
		const { shopkit, storage } = client(fake.fetch);

		// `successUrl` is optional on the type (inline mode needs none), so the
		// runtime check is what stands between a redirect caller who forgot it
		// and an opaque 400 — or, on start(), a cart created for nothing.
		const implicitRedirect: StartCheckoutInput = {
			backUrl: "https://myshop.test/",
		};
		await expect(shopkit.checkout.start(implicitRedirect)).rejects.toThrow(
			ShopkitConfigError,
		);
		await expect(shopkit.checkout.start(implicitRedirect)).rejects.toThrow(
			/successUrl/,
		);
		await expect(shopkit.checkout.start(implicitRedirect)).rejects.toThrow(
			/inline/,
		);

		const explicitRedirect: CreateSessionInput = {
			cartId: "cart-1",
			successMode: "redirect",
		};
		await expect(
			shopkit.checkout.createSession(explicitRedirect),
		).rejects.toThrow(ShopkitConfigError);

		await expect(
			shopkit.checkout.createSession({ cartId: "cart-1", successUrl: "   " }),
		).rejects.toThrow(ShopkitConfigError);

		expect(fake.calls).toHaveLength(0);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("rejects a successMode the platform does not know", async () => {
		const fake = createFakeFetch([]);
		const { shopkit } = client(fake.fetch);

		await expect(
			shopkit.checkout.start({
				successUrl: "https://myshop.test/order",
				successMode: "popup" as SuccessMode,
			}),
		).rejects.toThrow(/successMode/);
		expect(fake.calls).toHaveLength(0);
	});

	it("exports the vocabulary and types the confirmation echo", () => {
		const modes: readonly SuccessMode[] = SUCCESS_MODES;
		expect(modes).toEqual(["redirect", "inline"]);

		const confirmation: SessionConfirmation = {
			status: "completed",
			orderNumber: 1,
			successMode: "inline",
		};
		expect(confirmation.successMode).toBe("inline");
	});
});
