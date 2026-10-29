import { describe, expect, expectTypeOf, it } from "vitest";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import {
	ShopkitApiError,
	ShopkitAuthError,
	ShopkitNetworkError,
	ShopkitScopeError,
} from "../src/sdk/errors.js";
import { DEFAULT_SHOPKIT_SCOPES } from "../src/sdk/scopes.js";
import type {
	NewsletterSettings,
	NewsletterSubscribeInput,
} from "../src/sdk/types/newsletter.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

function client(
	fetchImpl: typeof globalThis.fetch,
	overrides: Record<string, unknown> = {},
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		consent: false,
		...overrides,
	});
}

function base64url(value: string): string {
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An unsigned-looking customer JWT; the kit only ever decodes the payload. */
function jwt(sub: string): string {
	const payload = {
		sub,
		aud: "customer",
		exp: Math.floor(Date.now() / 1000) + 900,
	};
	return `${base64url(JSON.stringify({ alg: "HS256" }))}.${base64url(JSON.stringify(payload))}.sig`;
}

function tokenOf(call: { headers: Headers } | undefined): string | null {
	return call?.headers.get("x-customer-token") ?? null;
}

/** An error as the gateway answers it: problem+json with a stable `code`. */
function problem(status: number, title: string, code: string, detail: string) {
	return {
		status,
		body: {
			type: "https://api.quickbutik.com/problems/api-error",
			title,
			status,
			detail,
			instance: "/v2/newsletter/subscribe",
			code,
		},
	};
}

const SUBSCRIBE = "POST /v2/newsletter/subscribe";
const SETTINGS = "GET /v2/shop/newsletter";

describe("newsletter.subscribe", () => {
	it("posts the email and the names, and resolves with nothing on 204", async () => {
		const fake = createFakeFetch([{ match: SUBSCRIBE, status: 204, text: "" }]);

		const result = await client(fake.fetch).newsletter.subscribe({
			email: "anna@example.test",
			firstName: "Anna",
			lastName: "Svensson",
		});

		expect(result).toBeUndefined();
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]?.method).toBe("POST");
		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe(
			"/v2/newsletter/subscribe",
		);
		expect(fake.calls[0]?.body).toEqual({
			email: "anna@example.test",
			firstName: "Anna",
			lastName: "Svensson",
		});
		expect(fake.calls[0]?.headers.get("authorization")).toBe(
			`Bearer ${TEST_KEY}`,
		);
	});

	it("sends only the given optional fields", async () => {
		const fake = createFakeFetch([{ match: SUBSCRIBE, status: 204, text: "" }]);
		await client(fake.fetch).newsletter.subscribe({
			email: "anna@example.test",
		});
		expect(fake.calls[0]?.body).toEqual({ email: "anna@example.test" });
	});

	it("never sends the customer token, even with a customer logged in", async () => {
		const fake = createFakeFetch([{ match: SUBSCRIBE, status: 204, text: "" }]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });

		await shopkit.newsletter.subscribe({ email: "anna@example.test" });

		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(tokenOf(fake.calls[0])).toBeNull();
	});

	it.each([
		[409, "Conflict", "newsletter_disabled", false],
		[422, "Unprocessable Entity", "newsletter_invalid_email", false],
		[502, "Bad Gateway", "newsletter_subscribe_failed", true],
		[429, "Too Many Requests", "rate_limited", true],
	])("throws a plain ShopkitApiError for %i %s (%s)", async (status, title, code, retryable) => {
		const fake = createFakeFetch([
			{ match: SUBSCRIBE, ...problem(status, title, code, "Refused") },
		]);

		const error = await client(fake.fetch)
			.newsletter.subscribe({ email: "anna@example.test" })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(error).not.toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitApiError).status).toBe(status);
		expect((error as ShopkitApiError).code).toBe(code);
		expect((error as ShopkitApiError).message).toBe("Refused");
		expect((error as ShopkitApiError).retryable).toBe(retryable);
	});

	it("puts the fields of a 400 validation problem on details", async () => {
		const errors = [
			{ field: "/email", message: "must NOT have more than 254 characters" },
		];
		const fake = createFakeFetch([
			{
				match: SUBSCRIBE,
				status: 400,
				body: {
					type: "https://api.quickbutik.com/problems/validation-error",
					title: "Validation Error",
					status: 400,
					detail: "Request validation failed",
					errors,
				},
			},
		]);
		const error = await client(fake.fetch)
			.newsletter.subscribe({ email: `${"a".repeat(250)}@example.test` })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(error).not.toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitApiError).status).toBe(400);
		expect((error as ShopkitApiError).code).toBeNull();
		expect((error as ShopkitApiError).details).toEqual(errors);
	});

	it("surfaces the gateway's scope refusal as a 403 ShopkitApiError", async () => {
		const fake = createFakeFetch([
			{
				match: SUBSCRIBE,
				status: 403,
				body: {
					type: "https://api.quickbutik.com/problems/forbidden",
					title: "Forbidden",
					status: 403,
					detail: "Insufficient permissions",
					required_scopes: ["newsletter:subscribe"],
				},
			},
		]);
		const error = await client(fake.fetch)
			.newsletter.subscribe({ email: "anna@example.test" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(error).not.toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitApiError).status).toBe(403);
		expect((error as ShopkitApiError).body).toMatchObject({
			required_scopes: ["newsletter:subscribe"],
		});
	});
});

describe("newsletter.isEnabled", () => {
	it.each([
		true,
		false,
	])("answers %s from the shop's settings", async (enabled) => {
		const fake = createFakeFetch([{ match: SETTINGS, body: { enabled } }]);
		expect(await client(fake.fetch).newsletter.isEnabled()).toBe(enabled);
		expect(fake.calls[0]?.method).toBe("GET");
	});

	it("is read once per client and without a customer token", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, body: { enabled: true } },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });

		const [first, second] = await Promise.all([
			shopkit.newsletter.isEnabled(),
			shopkit.newsletter.isEnabled(),
		]);
		const third = await shopkit.newsletter.isEnabled();

		expect([first, second, third]).toEqual([true, true, true]);
		expect(shopkit.newsletter.isEnabled()).toBe(shopkit.newsletter.isEnabled());
		expect(fake.calls).toHaveLength(1);
		expect(tokenOf(fake.calls[0])).toBeNull();
	});

	it("is read again by another client", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, body: { enabled: true } },
			{ match: SETTINGS, body: { enabled: false } },
		]);
		expect(await client(fake.fetch).newsletter.isEnabled()).toBe(true);
		expect(await client(fake.fetch).newsletter.isEnabled()).toBe(false);
		expect(fake.calls).toHaveLength(2);
	});

	it("unwraps api-core's envelope", async () => {
		const fake = createFakeFetch([
			{
				match: SETTINGS,
				body: { data: { enabled: true }, statusCode: 200 },
			},
		]);
		expect(await client(fake.fetch).newsletter.isEnabled()).toBe(true);
	});

	it("forgets a failed read, so the next call asks again", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, status: 500, body: { message: "boom" } },
			{ match: SETTINGS, body: { enabled: true } },
		]);
		const shopkit = client(fake.fetch);

		const error = await shopkit.newsletter.isEnabled().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ShopkitApiError);
		expect((error as ShopkitApiError).status).toBe(500);
		expect(await shopkit.newsletter.isEnabled()).toBe(true);
		expect(await shopkit.newsletter.isEnabled()).toBe(true);
		expect(fake.calls).toHaveLength(2);
	});

	it("forgets an aborted read too", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, body: { enabled: true } },
		]);
		const shopkit = client(fake.fetch);
		const controller = new AbortController();
		controller.abort();

		const error = await shopkit.newsletter
			.isEnabled({ signal: controller.signal })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ShopkitNetworkError);
		expect(await shopkit.newsletter.isEnabled()).toBe(true);
	});
});

describe("newsletter scopes", () => {
	it("newsletter:subscribe is in the default bundle", () => {
		expect(DEFAULT_SHOPKIT_SCOPES).toContain("newsletter:subscribe");
	});

	it("lets a storefront:read key check the settings but not subscribe", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, body: { enabled: true } },
		]);
		const shopkit = client(fake.fetch, { scopes: ["storefront:read"] });

		expect(await shopkit.newsletter.isEnabled()).toBe(true);
		const error = await shopkit.newsletter
			.subscribe({ email: "anna@example.test" })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ShopkitScopeError);
		expect((error as ShopkitScopeError).required).toBe("newsletter:subscribe");
		expect(fake.calls).toHaveLength(1);
	});

	it("lets a newsletter:subscribe key do both", async () => {
		const fake = createFakeFetch([
			{ match: SETTINGS, body: { enabled: true } },
			{ match: SUBSCRIBE, status: 204, text: "" },
		]);
		const shopkit = client(fake.fetch, { scopes: ["newsletter:subscribe"] });
		expect(await shopkit.newsletter.isEnabled()).toBe(true);
		await shopkit.newsletter.subscribe({ email: "anna@example.test" });
		expect(fake.calls).toHaveLength(2);
	});

	it("refuses both locally without either scope", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch, { scopes: ["products:read"] });

		expect(() => shopkit.newsletter.isEnabled()).toThrow(ShopkitScopeError);
		expect(() => shopkit.newsletter.isEnabled()).toThrow(
			/newsletter\.isEnabled\(\) requires the "newsletter:subscribe" scope/,
		);
		await expect(
			shopkit.newsletter.subscribe({ email: "anna@example.test" }),
		).rejects.toThrow(
			/newsletter\.subscribe\(\) requires the "newsletter:subscribe" scope/,
		);
		expect(fake.calls).toHaveLength(0);
	});
});

describe("newsletter wire types", () => {
	it("match the request and response the API declares", () => {
		expectTypeOf<NewsletterSubscribeInput>().toEqualTypeOf<{
			email: string;
			firstName?: string;
			lastName?: string;
		}>();
		expectTypeOf<NewsletterSettings>().toEqualTypeOf<{ enabled: boolean }>();
	});

	it("isEnabled() resolves to a boolean and subscribe() to nothing", () => {
		type Newsletter = ReturnType<typeof client>["newsletter"];
		expectTypeOf<ReturnType<Newsletter["isEnabled"]>>().toEqualTypeOf<
			Promise<boolean>
		>();
		expectTypeOf<ReturnType<Newsletter["subscribe"]>>().toEqualTypeOf<
			Promise<void>
		>();
	});
});
