import { describe, expect, it, vi } from "vitest";
import {
	createMemoryStorage,
	createRequestCookieStorage,
	type StorageAdapter,
} from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { CUSTOMER_EVENT, decodeJwtPayload } from "../src/sdk/customer-auth.js";
import {
	ShopkitApiError,
	ShopkitAuthError,
	ShopkitScopeError,
} from "../src/sdk/errors.js";
import { DEFAULT_SHOPKIT_SCOPES } from "../src/sdk/scopes.js";
import { unwrapEnvelope } from "../src/sdk/transport.js";
import type { CustomerState } from "../src/sdk/types/customer.js";
import { getProductPromise } from "../src/state/product-cache.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

const SESSION_KEY = "qb_customer_session";

function base64url(value: string): string {
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An unsigned-looking JWT; the kit only ever decodes the payload. */
function jwt(sub: string, expSecondsFromNow = 900): string {
	const payload = {
		sub,
		aud: "customer",
		exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
	};
	return `${base64url(JSON.stringify({ alg: "HS256" }))}.${base64url(JSON.stringify(payload))}.sig`;
}

const in15m = () => new Date(Date.now() + 15 * 60_000).toISOString();
const in30d = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

const CUSTOMER = {
	id: 123,
	email: "anna@example.test",
	firstName: "Anna",
	lastName: "Svensson",
	phone: null,
	isCompany: false,
	companyName: null,
	companyNumber: null,
	address: null,
	group: { id: 7, name: "Återförsäljare", priceVatDisplay: "excl" },
};

function sessionBody(sub = "123", refreshToken = "qb_crt_1") {
	return {
		accessToken: jwt(sub),
		accessTokenExpiresAt: in15m(),
		refreshToken,
		refreshTokenExpiresAt: in30d(),
		customer: { ...CUSTOMER, id: Number(sub) },
	};
}

const PAGE = { data: [], has_more: false, next_cursor: null };

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

function tokenOf(call: { headers: Headers } | undefined): string | null {
	return call?.headers.get("x-customer-token") ?? null;
}

describe("customers.login", () => {
	it("stores the session and sends the token with every later request", async () => {
		const body = sessionBody();
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);

		const result = await shopkit.customers.login({
			email: "anna@example.test",
			password: "hunter2",
		});
		await shopkit.products.list();

		expect(result.customer.firstName).toBe("Anna");
		expect(result.accessToken).toBe(body.accessToken);
		expect(fake.calls[0]?.body).toEqual({
			email: "anna@example.test",
			password: "hunter2",
		});
		// The login call itself carries no customer token; the key stays put.
		expect(tokenOf(fake.calls[0])).toBeNull();
		expect(tokenOf(fake.calls[1])).toBe(body.accessToken);
		expect(fake.calls[1]?.headers.get("authorization")).toBe(
			`Bearer ${TEST_KEY}`,
		);
		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(shopkit.customers.current?.id).toBe(123);
		const stored = await shopkit.storage.get(SESSION_KEY);
		expect(stored).toContain(body.refreshToken);
	});

	it("sends no token as a guest", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch);
		await shopkit.products.list();
		expect(tokenOf(fake.calls[0])).toBeNull();
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("throws a ShopkitAuthError with the code for wrong credentials", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 401,
				body: {
					statusCode: 401,
					message: "Invalid email or password",
					code: "invalid_credentials",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		const error = await shopkit.customers
			.login({ email: "a@b.test", password: "x" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect((error as ShopkitAuthError).code).toBe("invalid_credentials");
		expect((error as ShopkitAuthError).status).toBe(401);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("never calls onUnauthorized for a customer-token 401", async () => {
		const onUnauthorized = vi.fn(() => "qb_pk_shop123_new");
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 401,
				body: { statusCode: 401, message: "no", code: "invalid_credentials" },
			},
		]);
		const shopkit = client(fake.fetch, { onUnauthorized });
		await expect(
			shopkit.customers.login({ email: "a@b.test", password: "x" }),
		).rejects.toBeInstanceOf(ShopkitAuthError);
		expect(onUnauthorized).not.toHaveBeenCalled();
	});

	it("still rotates the publishable key on a plain 401, keeping the customer token", async () => {
		const onUnauthorized = vi.fn(
			() => "qb_pk_shop123_rotated0123456789abcdef0123",
		);
		const token = jwt("123");
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 401,
				body: { statusCode: 401, message: "bad key" },
			},
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { onUnauthorized });
		await shopkit.customers.setSession({ accessToken: token });
		await shopkit.products.list();
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
		expect(fake.calls[1]?.headers.get("authorization")).toBe(
			"Bearer qb_pk_shop123_rotated0123456789abcdef0123",
		);
		expect(tokenOf(fake.calls[1])).toBe(token);
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});

	it("forgets the cart when a different customer logs in", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody("123") },
			{ match: "POST /v2/account/login", body: sessionBody("456") },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		await shopkit.storage.set("qb_cart_id", "cart-of-123");
		await shopkit.customers.login({ email: "b@b.test", password: "y" });
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});

	it("keeps the cart when the same customer logs in again", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody("123") },
			{ match: "POST /v2/account/login", body: sessionBody("123") },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		await shopkit.storage.set("qb_cart_id", "cart-of-123");
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		expect(await shopkit.storage.get("qb_cart_id")).toBe("cart-of-123");
	});
});

function authError(status: number, code: string) {
	return { status, body: { statusCode: status, message: code, code } };
}

describe("customers.register", () => {
	const INPUT = {
		email: "anna@example.test",
		password: "secret1",
		firstName: "Anna",
		lastName: "Svensson",
	};

	it("logs the new customer in like login() and tells listeners", async () => {
		const body = sessionBody();
		const fake = createFakeFetch([
			{ match: "POST /v2/account/register", status: 201, body },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		const result = await shopkit.customers.register({
			...INPUT,
			companyName: "Anna AB",
			companyNumber: "556677-8899",
			clubOptIn: true,
		});
		await shopkit.products.list();

		expect(result).toEqual({ status: "logged_in", ...body });
		expect(fake.calls[0]?.body).toEqual({
			...INPUT,
			companyName: "Anna AB",
			companyNumber: "556677-8899",
			clubOptIn: true,
		});
		expect(tokenOf(fake.calls[0])).toBeNull();
		expect(tokenOf(fake.calls[1])).toBe(body.accessToken);
		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(shopkit.customers.current?.firstName).toBe("Anna");
		expect(await shopkit.storage.get(SESSION_KEY)).toContain(body.refreshToken);
		expect(changes).toEqual([{ customerId: "123", customer: body.customer }]);
	});

	it("asks for verification for an earlier guest's email, without logging in", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/register",
				status: 202,
				body: { verificationRequired: true },
			},
			{ match: "POST /v2/account/password/reset", body: sessionBody() },
		]);
		const shopkit = client(fake.fetch);
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		const result = await shopkit.customers.register(INPUT);

		expect(result).toEqual({ status: "verification_required" });
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await shopkit.storage.get(SESSION_KEY)).toBeNull();
		expect(changes).toEqual([]);

		// The emailed code finishes the registration and logs in.
		await shopkit.customers.resetPassword({
			email: INPUT.email,
			code: "ABCD2345",
			password: INPUT.password,
		});
		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(changes).toHaveLength(1);
	});

	it("answers login_required without logging in when no session could be opened", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/register",
				status: 201,
				body: { loginRequired: true },
			},
		]);
		const shopkit = client(fake.fetch);
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));
		const result = await shopkit.customers.register(INPUT);
		expect(result).toEqual({ status: "login_required" });
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await shopkit.storage.get(SESSION_KEY)).toBeNull();
		expect(changes).toEqual([]);
	});

	it("sends only the given optional fields", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/register", status: 201, body: sessionBody() },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.register(INPUT);
		expect(fake.calls[0]?.body).toEqual(INPUT);
	});

	it("forgets the cart of the customer logged in before", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody("123") },
			{
				match: "POST /v2/account/register",
				status: 201,
				body: sessionBody("456"),
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		await shopkit.storage.set("qb_cart_id", "cart-of-123");
		await shopkit.customers.register(INPUT);
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});

	it.each([
		[403, "signup_disabled"],
		[409, "email_taken"],
		[422, "invalid_email"],
		[422, "invalid_name"],
		[422, "invalid_password"],
		[404, "customer_login_disabled"],
		[429, "rate_limited"],
	])("throws a ShopkitAuthError for %i %s and stays a guest", async (status, code) => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/register", ...authError(status, code) },
		]);
		const shopkit = client(fake.fetch);
		const error = await shopkit.customers
			.register(INPUT)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe(code);
		expect((error as ShopkitAuthError).status).toBe(status);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});
});

describe("customers.requestPasswordReset", () => {
	it("posts the email without a customer token and resolves on 202", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/password/forgot", status: 202, text: "" },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		await expect(
			shopkit.customers.requestPasswordReset({ email: "anna@example.test" }),
		).resolves.toBeUndefined();
		expect(fake.calls[0]?.body).toEqual({ email: "anna@example.test" });
		expect(tokenOf(fake.calls[0])).toBeNull();
		// Asking for a code changes nothing about who is logged in.
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});

	it("throws a ShopkitAuthError when rate limited", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/password/forgot",
				...authError(429, "rate_limited"),
			},
		]);
		const shopkit = client(fake.fetch);
		const error = await shopkit.customers
			.requestPasswordReset({ email: "a@b.test" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe("rate_limited");
	});
});

describe("customers.resetPassword", () => {
	const INPUT = {
		email: "anna@example.test",
		code: "abcd-2345",
		password: "newsecret",
	};

	it("logs the customer in like login() with the new session", async () => {
		const body = sessionBody("123", "qb_crt_reset");
		const fake = createFakeFetch([
			{ match: "POST /v2/account/password/reset", body },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		const result = await shopkit.customers.resetPassword(INPUT);
		await shopkit.products.list();

		expect(result.refreshToken).toBe("qb_crt_reset");
		// The code goes as typed; the platform normalises it.
		expect(fake.calls[0]?.body).toEqual(INPUT);
		expect(tokenOf(fake.calls[0])).toBeNull();
		expect(tokenOf(fake.calls[1])).toBe(body.accessToken);
		expect(shopkit.customers.current?.id).toBe(123);
		expect(await shopkit.storage.get(SESSION_KEY)).toContain("qb_crt_reset");
		expect(changes).toEqual([{ customerId: "123", customer: body.customer }]);
	});

	it("throws password_changed_login_required when the password changed but no session could be opened", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/password/reset",
				body: { loginRequired: true },
			},
		]);
		const shopkit = client(fake.fetch);
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));
		const error = await shopkit.customers
			.resetPassword(INPUT)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe(
			"password_changed_login_required",
		);
		expect((error as ShopkitAuthError).message).toMatch(/new password/);
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await shopkit.storage.get(SESSION_KEY)).toBeNull();
		expect(changes).toEqual([]);
	});

	it("forgets the cart of another customer logged in before", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody("456") },
			{ match: "POST /v2/account/password/reset", body: sessionBody("123") },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "b@b.test", password: "y" });
		await shopkit.storage.set("qb_cart_id", "cart-of-456");
		await shopkit.customers.resetPassword(INPUT);
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});

	it.each([
		[400, "invalid_reset_code"],
		[422, "invalid_password"],
		[403, "customer_blocked"],
		[429, "rate_limited"],
	])("throws a ShopkitAuthError for %i %s and stays a guest", async (status, code) => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/password/reset", ...authError(status, code) },
		]);
		const shopkit = client(fake.fetch);
		const error = await shopkit.customers
			.resetPassword(INPUT)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe(code);
		expect((error as ShopkitAuthError).status).toBe(status);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});
});

describe("customers.logout", () => {
	it("revokes server-side and clears the session, cart and checkout session", async () => {
		const body = sessionBody();
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		await shopkit.storage.set("qb_cart_id", "cart-1");
		await shopkit.storage.set("qb_checkout_session", "sess-1");
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		await shopkit.customers.logout();

		expect(fake.calls[1]?.body).toEqual({ refreshToken: body.refreshToken });
		expect(tokenOf(fake.calls[1])).toBeNull();
		expect(await shopkit.storage.get(SESSION_KEY)).toBeNull();
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
		expect(await shopkit.storage.get("qb_checkout_session")).toBeNull();
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(shopkit.customers.current).toBeNull();
		expect(changes).toEqual([null]);
	});

	it("still logs out locally when the revoke fails", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody() },
			{ match: "POST /v2/account/logout", status: 500, body: {} },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		await shopkit.storage.set("qb_cart_id", "cart-1");
		await expect(shopkit.customers.logout()).resolves.toBeUndefined();
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});

	it("dispatches qb:customer on document", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody() },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		const shopkit = client(fake.fetch);
		const seen: unknown[] = [];
		const listener = (event: Event) => seen.push((event as CustomEvent).detail);
		document.addEventListener(CUSTOMER_EVENT, listener);
		try {
			await shopkit.customers.login({ email: "a@b.test", password: "x" });
			await shopkit.customers.logout();
		} finally {
			document.removeEventListener(CUSTOMER_EVENT, listener);
		}
		expect(seen).toHaveLength(2);
		expect(seen[0]).toEqual({ customerId: "123" });
		expect(seen[1]).toBeNull();
	});
});

describe("token renewal", () => {
	it("refreshes once for many concurrent expired requests, then retries each", async () => {
		const fresh = sessionBody("123", "qb_crt_2");
		const expired = {
			statusCode: 401,
			message: "expired",
			code: "customer_token_expired",
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/products", status: 401, body: expired },
			{ match: "GET /v2/products", status: 401, body: expired },
			{ match: "GET /v2/products", status: 401, body: expired },
			{ match: "POST /v2/account/refresh", body: fresh },
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		// The kit thinks the token is good; the platform's clock disagrees.
		const old = jwt("123");
		await shopkit.customers.setSession({
			accessToken: old,
			accessTokenExpiresAt: in15m(),
			refreshToken: "qb_crt_1",
			refreshTokenExpiresAt: in30d(),
		});

		await Promise.all([
			shopkit.products.list(),
			shopkit.products.list(),
			shopkit.products.list(),
		]);

		const refreshes = fake.calls.filter((c) =>
			c.url.endsWith("/account/refresh"),
		);
		expect(refreshes).toHaveLength(1);
		expect(refreshes[0]?.body).toEqual({ refreshToken: "qb_crt_1" });
		expect(tokenOf(refreshes[0])).toBeNull();
		const gets = fake.calls.filter((c) => c.url.endsWith("/v2/products"));
		expect(gets.slice(0, 3).map(tokenOf)).toEqual([old, old, old]);
		expect(gets.slice(3).map(tokenOf)).toEqual([
			fresh.accessToken,
			fresh.accessToken,
			fresh.accessToken,
		]);
		// The rotated refresh token is what is remembered now.
		expect(await shopkit.storage.get(SESSION_KEY)).toContain("qb_crt_2");
		expect(await shopkit.storage.get(SESSION_KEY)).not.toContain("qb_crt_1");
	});

	it("renews proactively when the token expires within 30 seconds", async () => {
		const fresh = sessionBody("123", "qb_crt_2");
		const fake = createFakeFetch([
			{ match: "POST /v2/account/refresh", body: fresh },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123", 10),
			accessTokenExpiresAt: new Date(Date.now() + 10_000).toISOString(),
			refreshToken: "qb_crt_1",
		});
		await shopkit.products.list();
		expect(fake.calls.map((c) => c.url.split("/v2")[1])).toEqual([
			"/account/refresh",
			"/products",
		]);
		expect(tokenOf(fake.calls[1])).toBe(fresh.accessToken);
	});

	it("retries a POST with the renewed token after customer_token_expired", async () => {
		const fresh = sessionBody("123", "qb_crt_2");
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 401,
				body: {
					statusCode: 401,
					message: "expired",
					code: "customer_token_expired",
				},
			},
			{ match: "POST /v2/account/refresh", body: fresh },
			{
				match: "POST /v2/cart",
				body: { id: "cart-1", storeId: 42, items: [] },
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123"),
			refreshToken: "qb_crt_1",
		});
		const cart = await shopkit.cart.create();
		expect(cart.id).toBe("cart-1");
		expect(tokenOf(fake.calls[2])).toBe(fresh.accessToken);
	});

	it("drops the session and reads as a guest when the refresh is refused", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 401,
				body: {
					statusCode: 401,
					message: "expired",
					code: "customer_token_expired",
				},
			},
			{
				match: "POST /v2/account/refresh",
				status: 401,
				body: {
					statusCode: 401,
					message: "revoked",
					code: "customer_token_invalid",
				},
			},
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123"),
			refreshToken: "qb_crt_1",
		});
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		await expect(shopkit.products.list()).resolves.toEqual(PAGE);
		expect(tokenOf(fake.calls[2])).toBeNull();
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(changes).toEqual([null]);
	});

	it("keeps the session when the refresh fails transiently", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/refresh", status: 503, body: {} },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123", -60),
			accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshToken: "qb_crt_1",
			refreshTokenExpiresAt: in30d(),
		});
		await expect(shopkit.products.list()).rejects.toBeInstanceOf(
			ShopkitApiError,
		);
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});

	it("getAccessToken() renews an expired token", async () => {
		const fresh = sessionBody("123", "qb_crt_2");
		const fake = createFakeFetch([
			{ match: "POST /v2/account/refresh", body: fresh },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123", -1),
			refreshToken: "qb_crt_1",
		});
		expect(await shopkit.customers.getAccessToken()).toBe(fresh.accessToken);
	});

	it("getAccessToken() is null for a guest", async () => {
		const shopkit = client(createFakeFetch([]).fetch);
		expect(await shopkit.customers.getAccessToken()).toBeNull();
	});
});

describe("refused tokens", () => {
	const invalid = {
		type: "about:blank",
		title: "Unauthorized",
		status: 401,
		detail: "Customer token is invalid",
		code: "customer_token_invalid",
	};

	it("retries a GET anonymously after customer_token_invalid", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", status: 401, body: invalid },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		const token = jwt("123");
		await shopkit.customers.setSession({
			accessToken: token,
			refreshToken: "r",
		});
		await shopkit.storage.set("qb_cart_id", "bound-cart");
		const changes: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => changes.push(state));

		await expect(shopkit.products.list()).resolves.toEqual(PAGE);
		expect(tokenOf(fake.calls[0])).toBe(token);
		expect(tokenOf(fake.calls[1])).toBeNull();
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await shopkit.storage.get(SESSION_KEY)).toBeNull();
		// The cart was bound to the customer; a guest can no longer read it.
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
		expect(changes).toEqual([null]);
	});

	it("does not retry a POST anonymously", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 401, body: invalid },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("123"),
			refreshToken: "r",
		});
		const error = await shopkit.cart.create().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe("customer_token_invalid");
		expect(fake.calls).toHaveLength(1);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("treats a token for another shop like an invalid one", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 403,
				body: {
					statusCode: 403,
					message: "no",
					code: "customer_token_shop_mismatch",
				},
			},
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		await expect(shopkit.products.list()).resolves.toEqual(PAGE);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("surfaces cart_customer_mismatch as an auth error without touching the session", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/cart/cart-1",
				status: 403,
				body: {
					statusCode: 403,
					message: "no",
					code: "cart_customer_mismatch",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		const error = await shopkit.cart.get("cart-1").catch((e: unknown) => e);
		expect((error as ShopkitAuthError).code).toBe("cart_customer_mismatch");
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});
});

describe("customers.me / club / config", () => {
	it("me() is null for a guest without a request", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch);
		expect(await shopkit.customers.me()).toBeNull();
		expect(fake.calls).toHaveLength(0);
	});

	it("me() reads the profile with the token", async () => {
		const token = jwt("123");
		const fake = createFakeFetch([
			{
				match: "GET /v2/account",
				body: { data: CUSTOMER, statusCode: 200, message: "ok" },
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: token });
		expect(shopkit.customers.current).toBeNull();
		const me = await shopkit.customers.me();
		expect(me?.group?.priceVatDisplay).toBe("excl");
		expect(tokenOf(fake.calls[0])).toBe(token);
		expect(shopkit.customers.current?.email).toBe(CUSTOMER.email);
	});

	it("me() answers null when the session was refused", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/account",
				status: 401,
				body: {
					statusCode: 401,
					message: "no",
					code: "customer_token_invalid",
				},
			},
			{
				match: "GET /v2/account",
				status: 401,
				body: {
					statusCode: 401,
					message: "no",
					code: "customer_token_required",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		expect(await shopkit.customers.me()).toBeNull();
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("club.get() reads the club with the token", async () => {
		const club = {
			member: true,
			active: true,
			points: { balance: 640, lifetime: 2140 },
			reward: { targetPoints: 1000, remaining: 360 },
			earning: { pointsPerUnit: 1, currency: "SEK" },
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/account/club", body: club },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		expect(await shopkit.customers.club.get()).toEqual(club);
	});

	it("club.get() surfaces customer_club_disabled", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/account/club",
				status: 404,
				body: {
					statusCode: 404,
					message: "off",
					code: "customer_club_disabled",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		const error = await shopkit.customers.club.get().catch((e: unknown) => e);
		expect((error as ShopkitAuthError).code).toBe("customer_club_disabled");
	});

	it("config() is read once per client and without a token", async () => {
		const config = {
			login: {
				enabled: true,
				signupAllowed: false,
				hidePricesForGuests: true,
				hideAddToCartForGuests: false,
			},
			customerGroups: { enabled: true },
			customerClub: { enabled: true, joinMethod: "registration" },
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/shop/customer-accounts", body: config },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("123") });
		expect(await shopkit.customers.config()).toEqual(config);
		expect(await shopkit.customers.config()).toEqual(config);
		expect(fake.calls).toHaveLength(1);
		expect(tokenOf(fake.calls[0])).toBeNull();
	});
});

describe("setSession", () => {
	it("is logged in synchronously, keyed on the token's sub, expiry from exp", async () => {
		const shopkit = client(createFakeFetch([]).fetch);
		const pending = shopkit.customers.setSession({ accessToken: jwt("42") });
		expect(shopkit.customers.isLoggedIn).toBe(true);
		await pending;
		expect(shopkit.customers.cacheKey).toMatch(/:42$/);
	});

	it("ignores a tampered stored value", async () => {
		const storage = createMemoryStorage();
		await storage.set(SESSION_KEY, "{not json");
		const shopkit = client(createFakeFetch([]).fetch, { storage });
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("an expired session without a refresh token is not a session", async () => {
		const shopkit = client(createFakeFetch([]).fetch);
		await shopkit.customers.setSession({ accessToken: jwt("1", -60) });
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("decodes base64url JWT payloads with non-ASCII claims", () => {
		const token = `x.${base64url(String.fromCharCode(...new TextEncoder().encode('{"sub":"7","name":"Åsa"}')))}.y`;
		expect(decodeJwtPayload(token)).toEqual({ sub: "7", name: "Åsa" });
		expect(decodeJwtPayload("garbage")).toBeNull();
	});
});

describe("per-request clients", () => {
	it("each request's client sends only its own cookie's session", async () => {
		const tokenA = jwt("111");
		const cookie = `${SESSION_KEY}=${encodeURIComponent(
			JSON.stringify({
				a: tokenA,
				ae: Date.now() + 600_000,
				r: "r",
				re: Date.now() + 86_400_000,
			}),
		)}`;
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const base = client(fake.fetch);
		const forA = base.withStorage(createRequestCookieStorage(cookie));
		const forB = base.withStorage(createRequestCookieStorage(""));

		expect(forA.customers.isLoggedIn).toBe(true);
		expect(forB.customers.isLoggedIn).toBe(false);
		await forA.products.list();
		await forB.products.list();
		expect(tokenOf(fake.calls[0])).toBe(tokenA);
		expect(tokenOf(fake.calls[1])).toBeNull();
		expect(base.customers.isLoggedIn).toBe(false);
	});

	it("a login on one client does not leak into another built from the same config", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody() },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const one = client(fake.fetch);
		const two = client(fake.fetch);
		await one.customers.login({ email: "a@b.test", password: "x" });
		await two.products.list();
		expect(two.customers.isLoggedIn).toBe(false);
		expect(tokenOf(fake.calls[1])).toBeNull();
	});

	it("writes the session as a Set-Cookie through a request cookie jar", async () => {
		const collect: string[] = [];
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: sessionBody() },
		]);
		const shopkit = client(fake.fetch).withStorage(
			createRequestCookieStorage("", {
				collect,
				attributes: { httpOnly: true, secure: true },
			}),
		);
		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		const cookie = collect.find((c) => c.startsWith(`${SESSION_KEY}=`));
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toMatch(/Max-Age=\d+/);
	});

	it("works with an async-only adapter", async () => {
		const map = new Map<string, string>();
		const asyncStorage: StorageAdapter = {
			kind: "async",
			get: async (key) => map.get(key) ?? null,
			set: async (key, value) => {
				map.set(key, value);
			},
			remove: async (key) => {
				map.delete(key);
			},
		};
		const token = jwt("9");
		map.set(
			SESSION_KEY,
			JSON.stringify({ a: token, ae: Date.now() + 600_000, r: null, re: null }),
		);
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch, { storage: asyncStorage });
		expect(shopkit.customers.isLoggedIn).toBe(false); // not read yet
		await shopkit.products.list();
		expect(tokenOf(fake.calls[0])).toBe(token);
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});
});

describe("product cache keys", () => {
	it("does not hand one customer's product to a guest or another customer", async () => {
		const product = (price: number) => ({
			id: "prod_1",
			name: "Tee",
			price,
			variants: [],
			images: [],
		});
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_1", body: product(100) },
			{ match: "POST /v2/account/login", body: sessionBody("123") },
			{ match: "GET /v2/products/prod_1", body: product(80) },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
			{ match: "GET /v2/products/prod_1", body: product(100) },
		]);
		const shopkit = client(fake.fetch);
		const guest = getProductPromise(shopkit, { id: "prod_1" });
		expect(getProductPromise(shopkit, { id: "prod_1" })).toBe(guest);
		expect((await guest)?.price).toBe(100);

		await shopkit.customers.login({ email: "a@b.test", password: "x" });
		const asCustomer = getProductPromise(shopkit, { id: "prod_1" });
		expect(asCustomer).not.toBe(guest);
		expect((await asCustomer)?.price).toBe(80);

		await shopkit.customers.logout();
		const guestAgain = getProductPromise(shopkit, { id: "prod_1" });
		expect(guestAgain).not.toBe(asCustomer);
		expect(guestAgain).not.toBe(guest);
		expect((await guestAgain)?.price).toBe(100);
	});
});

describe("scopes", () => {
	it("customer:session is in the default bundle", () => {
		expect(DEFAULT_SHOPKIT_SCOPES).toContain("customer:session");
	});

	it("gates the customer calls on customer:session", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch, { scopes: ["products:read"] });
		await expect(
			shopkit.customers.login({ email: "a@b.test", password: "x" }),
		).rejects.toBeInstanceOf(ShopkitScopeError);
		await expect(shopkit.customers.me()).rejects.toBeInstanceOf(
			ShopkitScopeError,
		);
		await expect(shopkit.customers.club.get()).rejects.toBeInstanceOf(
			ShopkitScopeError,
		);
		await expect(
			shopkit.customers.register({
				email: "a@b.test",
				password: "secret1",
				firstName: "A",
				lastName: "B",
			}),
		).rejects.toBeInstanceOf(ShopkitScopeError);
		await expect(
			shopkit.customers.requestPasswordReset({ email: "a@b.test" }),
		).rejects.toBeInstanceOf(ShopkitScopeError);
		await expect(
			shopkit.customers.resetPassword({
				email: "a@b.test",
				code: "ABCD2345",
				password: "secret1",
			}),
		).rejects.toBeInstanceOf(ShopkitScopeError);
		expect(() => shopkit.customers.config()).toThrow(ShopkitScopeError);
		expect(fake.calls).toHaveLength(0);
	});

	it("logout still clears locally without the scope", async () => {
		const fake = createFakeFetch([]);
		const shopkit = client(fake.fetch, { scopes: ["products:read"] });
		await shopkit.customers.setSession({
			accessToken: jwt("1"),
			refreshToken: "r",
		});
		await shopkit.customers.logout();
		expect(fake.calls).toHaveLength(0);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});
});

describe("error envelopes", () => {
	it("reads the code from api-core's envelope", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 403,
				body: {
					statusCode: 403,
					message: "Blocked",
					error: "Forbidden",
					code: "customer_blocked",
				},
			},
		]);
		const error = await client(fake.fetch)
			.customers.login({ email: "a@b.test", password: "x" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe("customer_blocked");
		expect((error as ShopkitAuthError).message).toBe("Blocked");
	});

	it("reads the code from the gateway's problem+json", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 429,
				body: {
					type: "https://quickbutik.com/problems/rate-limited",
					title: "Too Many Requests",
					status: 429,
					detail: "Too many login attempts",
					code: "rate_limited",
				},
			},
		]);
		const error = await client(fake.fetch)
			.customers.login({ email: "a@b.test", password: "x" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe("rate_limited");
		expect((error as ShopkitAuthError).message).toBe("Too many login attempts");
	});

	it("reads a code nested under error", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 403,
				body: {
					statusCode: 403,
					error: { code: "login_required", message: "Log in" },
				},
			},
		]);
		const error = await client(fake.fetch)
			.cart.create()
			.catch((e: unknown) => e);
		expect((error as ShopkitAuthError).code).toBe("login_required");
	});

	it("keeps any other code on a plain ShopkitApiError", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 409,
				body: {
					statusCode: 409,
					message: "Out of stock",
					code: "out_of_stock",
				},
			},
		]);
		const error = await client(fake.fetch)
			.cart.create()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(error).not.toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitApiError).code).toBe("out_of_stock");
	});

	it("ShopkitApiError.fromResponse decodes the code too", async () => {
		const error = await ShopkitApiError.fromResponse(
			new Response(
				JSON.stringify({
					statusCode: 401,
					message: "x",
					code: "customer_token_expired",
				}),
				{ status: 401 },
			),
			"fallback",
		);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect(error.code).toBe("customer_token_expired");
	});
});

describe("catalog pricing meta", () => {
	it("unwraps an envelope that carries meta", () => {
		expect(
			unwrapEnvelope({
				data: { id: "prod_1" },
				meta: {
					pricing: {
						audience: "customer_group",
						groupId: 7,
						vatDisplay: "excl",
					},
				},
				statusCode: 200,
				message: "ok",
			}),
		).toEqual({ id: "prod_1" });
	});

	it("leaves a bare { data, meta } alone", () => {
		const page = { data: [1], meta: {} };
		expect(unwrapEnvelope(page)).toBe(page);
	});
});

describe("catalog pricing from the platform", () => {
	const pricing = {
		audience: "customer_group",
		groupId: 7,
		vatDisplay: "excl",
	};
	const product = {
		id: "prod_1",
		name: "Tee",
		slug: "tee",
		price: 80,
		variants: [],
		images: [],
	};

	it("maps a list's top-level pricing to page.meta.pricing", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [product], has_more: false, next_cursor: null, pricing },
			},
			{
				match: "GET /v2/products/search",
				body: { data: [], has_more: false, next_cursor: null, pricing },
			},
		]);
		const shopkit = client(fake.fetch);
		expect((await shopkit.products.list()).meta?.pricing).toEqual(pricing);
		expect(
			(await shopkit.products.search({ search: "x" })).meta?.pricing,
		).toEqual(pricing);
	});

	it("leaves a page without pricing as it was", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		expect(await client(fake.fetch).products.list()).toEqual(PAGE);
	});

	it("puts a single read's envelope pricing on the product", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products/prod_1",
				body: { data: product, statusCode: 200, message: "ok", pricing },
			},
		]);
		const read = await client(fake.fetch).products.get("prod_1");
		expect(read?.name).toBe("Tee");
		expect(read?.pricing).toEqual(pricing);
	});

	it("getBySlug carries the page's pricing onto the product", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: { data: [product], has_more: false, next_cursor: null, pricing },
			},
		]);
		const read = await client(fake.fetch).products.getBySlug("tee");
		expect(read?.pricing).toEqual(pricing);
	});

	it("reads api-core's exact error body", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 401,
				body: {
					statusCode: 401,
					code: "invalid_credentials",
					errorCode: "INVALID_CREDENTIALS",
					message: "Invalid email or password",
				},
			},
		]);
		const error = await client(fake.fetch)
			.customers.login({ email: "a@b.test", password: "x" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitAuthError).code).toBe("invalid_credentials");
		expect((error as ShopkitAuthError).status).toBe(401);
		expect((error as ShopkitAuthError).message).toBe(
			"Invalid email or password",
		);
	});
});

describe("customers.config scope", () => {
	const config = {
		login: {
			enabled: true,
			signupAllowed: false,
			hidePricesForGuests: false,
			hideAddToCartForGuests: false,
		},
		customerGroups: { enabled: false },
		customerClub: { enabled: false, joinMethod: "manual" },
	};

	it("is allowed with storefront:read alone", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/shop/customer-accounts", body: config },
		]);
		const shopkit = client(fake.fetch, { scopes: ["storefront:read"] });
		expect(await shopkit.customers.config()).toEqual(config);
	});

	it("is allowed with customer:session alone", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/shop/customer-accounts", body: config },
		]);
		const shopkit = client(fake.fetch, { scopes: ["customer:session"] });
		expect(await shopkit.customers.config()).toEqual(config);
	});
});
