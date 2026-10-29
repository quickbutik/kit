import { describe, expect, it } from "vitest";
import {
	createMemoryStorage,
	createRequestCookieStorage,
	type StorageAdapter,
} from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { decodeJwtPayload } from "../src/sdk/customer-auth.js";
import {
	CUSTOMER_AUTH_ERROR_CODES,
	ShopkitApiError,
	ShopkitAuthError,
	ShopkitConfigError,
} from "../src/sdk/errors.js";
import type { CustomerState } from "../src/sdk/types/customer.js";
import { CartStore } from "../src/state/cart-store.js";
import {
	cartEnvelope,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

const SESSION_KEY = "qb_customer_session";
const PAGE = { data: [], has_more: false, next_cursor: null };

function base64url(value: string): string {
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A JWT whose `iat`/`exp` say it lives `ttl` seconds from `issuedAt` (server clock). */
function jwt(sub: string, ttl = 900, issuedAt = Date.now()): string {
	const iat = Math.floor(issuedAt / 1000);
	const payload = { sub, iat, exp: iat + ttl };
	return `h.${base64url(JSON.stringify(payload))}.s`;
}

function session(sub: string, refreshToken: string, ttl = 900) {
	return {
		accessToken: jwt(sub, ttl),
		accessTokenExpiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
		refreshToken,
		refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		customer: { id: Number(sub), email: `${sub}@x.test` },
	};
}

/** Stored form, as the kit writes it. */
function stored(
	token: string,
	accessIn: number,
	refresh: string | null,
	refreshIn = 86_400_000,
) {
	return JSON.stringify({
		a: token,
		ae: Date.now() + accessIn,
		r: refresh,
		re: refresh ? Date.now() + refreshIn : null,
	});
}

/**
 * A fake fetch whose requests to `path` wait for `release()`, so a test can
 * act while one is in flight.
 */
function gated(routes: FakeRoute[], path: string) {
	const fake = createFakeFetch(routes);
	let open!: () => void;
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	let arrived!: () => void;
	const waiting = new Promise<void>((resolve) => {
		arrived = resolve;
	});
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (new URL(url).pathname === path) {
			arrived();
			await gate;
		}
		return fake.fetch(input, init);
	}) as typeof globalThis.fetch;
	return { ...fake, fetch: fetchImpl, release: open, waiting };
}

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

const tokenOf = (call: { headers: Headers } | undefined) =>
	call?.headers.get("x-customer-token") ?? null;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("two clients sharing one storage", () => {
	it("a client with a stale in-memory session adopts the other's renewal instead of refreshing", async () => {
		const storage = createMemoryStorage();
		const old = jwt("1", 10);
		await storage.set(SESSION_KEY, stored(old, 10_000, "qb_crt_1"));
		const fresh = session("1", "qb_crt_2");
		const fake = createFakeFetch([
			{ match: "POST /v2/account/refresh", body: fresh },
			{ match: "GET /v2/products", body: PAGE },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const a = client(fake.fetch, { storage });
		const b = client(fake.fetch, { storage });
		expect(b.customers.isLoggedIn).toBe(true); // b holds the old pair in memory

		await a.products.list();
		await b.products.list();

		expect(
			fake.calls.filter((c) => c.url.endsWith("/account/refresh")),
		).toHaveLength(1);
		const gets = fake.calls.filter((c) => c.url.endsWith("/v2/products"));
		expect(gets.map(tokenOf)).toEqual([fresh.accessToken, fresh.accessToken]);
	});

	it("hears a login and a logout in another tab through the storage event", async () => {
		const storage = createMemoryStorage();
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: session("5", "r1") },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		const here = client(fake.fetch, { storage });
		const there = client(fake.fetch, { storage });
		const seen: Array<CustomerState | null> = [];
		here.customers.onChange((state) => seen.push(state));
		expect(here.customers.isLoggedIn).toBe(false);

		await there.customers.login({ email: "a@b.test", password: "x" });
		window.dispatchEvent(new StorageEvent("storage", { key: SESSION_KEY }));
		await flush();
		expect(here.customers.isLoggedIn).toBe(true);
		expect(seen.at(-1)?.customerId).toBe("5");

		await there.customers.logout();
		window.dispatchEvent(new StorageEvent("storage", { key: SESSION_KEY }));
		await flush();
		expect(here.customers.isLoggedIn).toBe(false);
		expect(seen.at(-1)).toBeNull();
	});

	it("re-reads cookie storage when the tab becomes visible", async () => {
		const storage = createMemoryStorage();
		const here = client(createFakeFetch([]).fetch, { storage });
		const seen: Array<CustomerState | null> = [];
		here.customers.onChange((state) => seen.push(state));
		expect(here.customers.isLoggedIn).toBe(false);
		await storage.set(SESSION_KEY, stored(jwt("8"), 600_000, "r"));
		document.dispatchEvent(new Event("visibilitychange"));
		await flush();
		expect(here.customers.isLoggedIn).toBe(true);
		expect(seen).toHaveLength(1);
	});
});

describe("silent expiry", () => {
	it("drops a stored session that can no longer produce a token", async () => {
		const storage = createMemoryStorage();
		await storage.set(SESSION_KEY, stored(jwt("1", -60), -60_000, null));
		await storage.set("qb_cart_id", "bound-cart");
		const shopkit = client(createFakeFetch([]).fetch, { storage });
		const seen: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => seen.push(state));
		const before = shopkit.customers.cacheKey;

		expect(shopkit.customers.isLoggedIn).toBe(false);
		await flush();
		expect(await storage.get(SESSION_KEY)).toBeNull();
		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(seen).toEqual([null]);
		expect(shopkit.customers.cacheKey).not.toBe(before);
	});

	it("a refresh token past its expiry counts as gone too", async () => {
		const storage = createMemoryStorage();
		await storage.set(SESSION_KEY, stored(jwt("1", -60), -60_000, "r", -1000));
		const shopkit = client(createFakeFetch([]).fetch, { storage });
		expect(shopkit.customers.isLoggedIn).toBe(false);
		await flush();
		expect(await storage.get(SESSION_KEY)).toBeNull();
	});
});

describe("customer switch", () => {
	it("forgets the cart when another customer's (expired) session was stored, with an async adapter", async () => {
		const map = new Map<string, string>([
			[SESSION_KEY, stored(jwt("1", -60), -60_000, null)],
			["qb_cart_id", "cart-of-1"],
		]);
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
		const shopkit = client(createFakeFetch([]).fetch, {
			storage: asyncStorage,
		});
		expect(shopkit.customers.cacheKey).toMatch(/:\?$/); // not read yet
		await shopkit.customers.setSession({
			accessToken: jwt("2"),
			refreshToken: "r",
		});
		expect(map.get("qb_cart_id")).toBeUndefined();
		expect(map.get(SESSION_KEY)).toContain(jwt("2"));
	});
});

describe("changes during a renewal", () => {
	function expiring() {
		const storage = createMemoryStorage();
		return { storage, value: stored(jwt("1", 10), 10_000, "qb_crt_1") };
	}

	it("a logout during the renewal wins: nothing is resurrected", async () => {
		const { storage, value } = expiring();
		await storage.set(SESSION_KEY, value);
		const fake = gated(
			[
				{ match: "POST /v2/account/refresh", body: session("1", "qb_crt_2") },
				{ match: "POST /v2/account/logout", status: 204, text: "" },
				{ match: "GET /v2/products", body: PAGE },
			],
			"/v2/account/refresh",
		);
		const shopkit = client(fake.fetch, { storage });
		const read = shopkit.products.list();
		await fake.waiting;
		await shopkit.customers.logout();
		fake.release();
		await read;

		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(await storage.get(SESSION_KEY)).toBeNull();
		expect(tokenOf(fake.calls.at(-1))).toBeNull();
	});

	it("a setSession during the renewal wins, and the request carries the new token", async () => {
		const { storage, value } = expiring();
		await storage.set(SESSION_KEY, value);
		const fake = gated(
			[
				{ match: "POST /v2/account/refresh", body: session("1", "qb_crt_2") },
				{ match: "GET /v2/products", body: PAGE },
			],
			"/v2/account/refresh",
		);
		const shopkit = client(fake.fetch, { storage });
		const read = shopkit.products.list();
		await fake.waiting;
		const other = jwt("2");
		await shopkit.customers.setSession({
			accessToken: other,
			refreshToken: "r2",
		});
		fake.release();
		await read;

		expect(tokenOf(fake.calls.at(-1))).toBe(other);
		expect(await storage.get(SESSION_KEY)).toContain(other);
	});

	it("POST waiters on a refused renewal all fail, with one refresh and no retries", async () => {
		const expired = {
			statusCode: 401,
			message: "e",
			code: "customer_token_expired",
		};
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 401, body: expired },
			{ match: "POST /v2/cart", status: 401, body: expired },
			{
				match: "POST /v2/account/refresh",
				status: 401,
				body: {
					statusCode: 401,
					message: "revoked",
					code: "customer_token_invalid",
				},
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("1"),
			refreshToken: "r",
		});
		const results = await Promise.allSettled([
			shopkit.cart.create(),
			shopkit.cart.create(),
		]);
		for (const result of results) {
			expect(result.status).toBe("rejected");
			expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
				ShopkitAuthError,
			);
		}
		expect(fake.calls.map((c) => c.url.split("/v2")[1])).toEqual([
			"/cart",
			"/cart",
			"/account/refresh",
		]);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});

	it("a guest retry uses the token of a session that landed meanwhile", async () => {
		const fake = gated(
			[
				{
					match: "GET /v2/products",
					status: 401,
					body: {
						statusCode: 401,
						message: "no",
						code: "customer_token_invalid",
					},
				},
				{ match: "GET /v2/products", body: PAGE },
			],
			"/v2/products",
		);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("1") });
		const read = shopkit.products.list();
		await fake.waiting;
		const newer = jwt("2");
		await shopkit.customers.setSession({ accessToken: newer });
		fake.release();
		await read;
		expect(tokenOf(fake.calls[1])).toBe(newer);
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});
});

describe("refresh failures", () => {
	it("an unexpected 4xx without a customer code keeps the session", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/refresh",
				status: 400,
				body: { statusCode: 400, message: "bad" },
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("1", -1),
			refreshToken: "r",
		});
		await expect(shopkit.products.list()).rejects.toBeInstanceOf(
			ShopkitApiError,
		);
		expect(shopkit.customers.isLoggedIn).toBe(true);
	});

	it("customer_blocked on refresh ends the session", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/refresh",
				status: 403,
				body: { statusCode: 403, message: "blocked", code: "customer_blocked" },
			},
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("1", -1),
			refreshToken: "r",
		});
		await shopkit.products.list();
		expect(shopkit.customers.isLoggedIn).toBe(false);
		expect(tokenOf(fake.calls[1])).toBeNull();
	});

	it("with maxRetries > 0 a transient refresh failure is retried and renews once", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/refresh", status: 503, body: {} },
			{ match: "POST /v2/account/refresh", body: session("1", "qb_crt_2") },
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { maxRetries: 1 });
		await shopkit.customers.setSession({
			accessToken: jwt("1", -1),
			refreshToken: "qb_crt_1",
		});
		await shopkit.products.list();
		const refreshes = fake.calls.filter((c) =>
			c.url.endsWith("/account/refresh"),
		);
		// The retry presents the same refresh token: safe, the platform's renewal
		// is idempotent for the previous token within its grace window.
		expect(refreshes.map((c) => c.body)).toEqual([
			{ refreshToken: "qb_crt_1" },
			{ refreshToken: "qb_crt_1" },
		]);
		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(await shopkit.storage.get(SESSION_KEY)).toContain("qb_crt_2");
	}, 10_000);
});

describe("rate limits", () => {
	it("a 429 outside /account stays a plain ShopkitApiError", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 429,
				body: { statusCode: 429, message: "slow", code: "rate_limited" },
			},
		]);
		const error = await client(fake.fetch)
			.products.list()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ShopkitApiError);
		expect(error).not.toBeInstanceOf(ShopkitAuthError);
		expect((error as ShopkitApiError).code).toBe("rate_limited");
		expect(CUSTOMER_AUTH_ERROR_CODES).not.toContain("rate_limited");
	});
});

describe("read-only storage", () => {
	it("never renews through a request cookie jar that collects nothing", async () => {
		const cookie = `${SESSION_KEY}=${encodeURIComponent(stored(jwt("1", 10), 10_000, "r"))}`;
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch).withStorage(
			createRequestCookieStorage(cookie),
		);
		await shopkit.products.list();
		// Still valid for 10 s: sent as it is, never refreshed.
		expect(fake.calls.map((c) => c.url.split("/v2")[1])).toEqual(["/products"]);
		expect(tokenOf(fake.calls[0])).not.toBeNull();
	});

	it("treats an expired access token as a guest there, without refreshing", async () => {
		const cookie = `${SESSION_KEY}=${encodeURIComponent(stored(jwt("1", -5), -5_000, "r"))}`;
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch).withStorage(
			createRequestCookieStorage(cookie),
		);
		expect(shopkit.customers.isLoggedIn).toBe(false);
		await shopkit.products.list();
		expect(fake.calls).toHaveLength(1);
		expect(tokenOf(fake.calls[0])).toBeNull();
	});

	it("customerSession.renew: false turns renewal off explicitly", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				status: 401,
				body: { statusCode: 401, message: "e", code: "customer_token_expired" },
			},
			{ match: "GET /v2/products", body: PAGE },
		]);
		const shopkit = client(fake.fetch, { customerSession: { renew: false } });
		await shopkit.customers.setSession({
			accessToken: jwt("1"),
			refreshToken: "r",
		});
		await shopkit.products.list();
		expect(fake.calls.map((c) => c.url.split("/v2")[1])).toEqual([
			"/products",
			"/products",
		]);
		expect(tokenOf(fake.calls[1])).toBeNull();
	});
});

describe("clock skew", () => {
	it("times the access token from receipt, not from a skewed server clock", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch);
		// The server's clock is an hour behind: by this machine's clock the
		// token "expired" 45 minutes ago, yet it was issued just now.
		const serverNow = Date.now() - 3_600_000;
		await shopkit.customers.setSession({
			accessToken: jwt("1", 900, serverNow),
			accessTokenExpiresAt: new Date(serverNow + 900_000).toISOString(),
			refreshToken: "r",
			refreshTokenExpiresAt: new Date(serverNow + 86_400_000).toISOString(),
		});
		await shopkit.products.list();
		expect(fake.calls.map((c) => c.url.split("/v2")[1])).toEqual(["/products"]);
	});
});

describe("me()", () => {
	const CUSTOMER = { id: 1, email: "a@b.test", firstName: "A" };

	it("shares one request between concurrent callers and tells listeners", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/account", body: CUSTOMER },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: jwt("1") });
		const seen: Array<CustomerState | null> = [];
		shopkit.customers.onChange((state) => seen.push(state));
		const key = shopkit.customers.cacheKey;
		const [one, two] = await Promise.all([
			shopkit.customers.me(),
			shopkit.customers.me(),
		]);
		expect(one).toEqual(CUSTOMER);
		expect(two).toBe(one);
		expect(fake.calls).toHaveLength(1);
		expect(seen.at(-1)?.customer).toEqual(CUSTOMER);
		// A profile is not a new customer: caches keyed on it stay put.
		expect(shopkit.customers.cacheKey).toBe(key);
	});

	it("discards a profile that arrives after a logout", async () => {
		const fake = gated(
			[
				{ match: "GET /v2/account", body: CUSTOMER },
				{ match: "POST /v2/account/logout", status: 204, text: "" },
			],
			"/v2/account",
		);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({
			accessToken: jwt("1"),
			refreshToken: "r",
		});
		const read = shopkit.customers.me();
		await fake.waiting;
		await shopkit.customers.logout();
		fake.release();
		expect(await read).toBeNull();
		expect(shopkit.customers.current).toBeNull();
	});
});

describe("setSession validation", () => {
	it.each([
		[{ accessToken: "" }],
		[{ accessToken: 42 }],
		[{ accessToken: "a.b.c", refreshToken: "" }],
		[{ accessToken: "a.b.c", accessTokenExpiresAt: "tomorrow-ish" }],
		[null],
	])("rejects %j", async (input) => {
		const shopkit = client(createFakeFetch([]).fetch);
		await expect(
			shopkit.customers.setSession(input as never),
		).rejects.toBeInstanceOf(ShopkitConfigError);
		expect(shopkit.customers.isLoggedIn).toBe(false);
	});
});

describe("malformed JWT payloads", () => {
	it.each([
		"no-dots",
		"a..c",
		`a.${base64url("[1,2]")}.c`,
		`a.${base64url("not json")}.c`,
		"a.@@@.c",
		`a.${base64url('{"sub":{"x":1},"exp":"soon"}')}.c`,
	])("%s decodes to nothing useful and still works as an opaque token", async (token) => {
		const claims = decodeJwtPayload(token);
		expect(claims === null || typeof claims.sub !== "string").toBe(true);
		const fake = createFakeFetch([{ match: "GET /v2/products", body: PAGE }]);
		const shopkit = client(fake.fetch);
		await shopkit.customers.setSession({ accessToken: token });
		expect(shopkit.customers.isLoggedIn).toBe(true);
		expect(shopkit.customers.cacheKey).toMatch(/:anon$/);
		await shopkit.products.list();
		expect(tokenOf(fake.calls[0])).toBe(token);
	});
});

describe("carts bound to another customer", () => {
	const mismatch = {
		statusCode: 403,
		message: "no",
		code: "cart_customer_mismatch",
	};

	it("current() forgets a cart this shopper cannot read", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", status: 403, body: mismatch },
		]);
		const shopkit = client(fake.fetch);
		await shopkit.storage.set("qb_cart_id", "cart-1");
		expect(await shopkit.cart.current()).toBeNull();
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});

	it("add() starts a fresh cart instead of failing against it", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ id: "cart-1" }) },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 401,
				body: {
					statusCode: 401,
					message: "no",
					code: "customer_token_required",
				},
			},
			{ match: "POST /v2/cart", body: cartEnvelope({ id: "cart-2" }) },
			{
				match: "POST /v2/cart/cart-2/items",
				body: cartEnvelope({ id: "cart-2" }),
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.storage.set("qb_cart_id", "cart-1");
		const cart = await shopkit.cart.add({ productId: "prod_1" });
		expect(cart.id).toBe("cart-2");
		expect(await shopkit.storage.get("qb_cart_id")).toBe("cart-2");
	});

	it("CartStore forgets the cart when an update hits it", async () => {
		const fake = createFakeFetch([
			{
				match: "PATCH /v2/cart/cart-1/items/line-1",
				status: 403,
				body: mismatch,
			},
		]);
		const shopkit = client(fake.fetch);
		await shopkit.storage.set("qb_cart_id", "cart-1");
		const store = new CartStore(shopkit);
		await store.updateItem("line-1", 2);
		expect(store.getSnapshot().cart).toBeNull();
		expect(store.getSnapshot().error).toBeInstanceOf(ShopkitAuthError);
		expect(await shopkit.storage.get("qb_cart_id")).toBeNull();
	});
});
