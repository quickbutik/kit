import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCookieHeader, serializeCookie } from "../src/runtime/cookies.js";
import {
	createCookieStorage,
	createMemoryStorage,
	createRequestCookieStorage,
	resolveStorage,
} from "../src/runtime/storage.js";

describe("cookie primitives", () => {
	it("parses a cookie header", () => {
		expect(parseCookieHeader("a=1; b=hello%20world")).toEqual({
			a: "1",
			b: "hello world",
		});
	});

	it("ignores malformed pairs rather than dropping the whole header", () => {
		expect(parseCookieHeader("=novalue; good=1; broken")).toEqual({
			good: "1",
		});
	});

	it("keeps a value with a bad escape verbatim", () => {
		expect(parseCookieHeader("a=%E0%A4%A")).toEqual({ a: "%E0%A4%A" });
	});

	it("serializes with lax same-site and a floored max-age", () => {
		const actual = serializeCookie("qb_cart_id", "abc", {
			maxAge: 10.9,
			secure: false,
		});
		expect(actual).toBe("qb_cart_id=abc; Path=/; Max-Age=10; SameSite=Lax");
	});
});

describe("createRequestCookieStorage", () => {
	it("reads from a request and collects writes as Set-Cookie strings", async () => {
		const collect: string[] = [];
		// A request-shaped object rather than `new Request(...)`: `cookie` is a
		// forbidden header name in a browser, so a DOM Request silently drops it.
		// Server runtimes hand you one that carries it, which is what this models.
		const request = {
			headers: {
				get: (name: string) => (name === "cookie" ? "qb_cart_id=cart-9" : null),
			},
		};
		const storage = createRequestCookieStorage(request, { collect });

		expect(await storage.get("qb_cart_id")).toBe("cart-9");

		await storage.set("qb_cart_id", "cart-10", { ttlSeconds: 60 });
		expect(await storage.get("qb_cart_id")).toBe("cart-10");
		expect(collect[0]).toContain("qb_cart_id=cart-10");
		expect(collect[0]).toContain("Max-Age=60");

		await storage.remove("qb_cart_id");
		expect(await storage.get("qb_cart_id")).toBeNull();
		expect(collect[1]).toContain("Max-Age=0");
	});

	it("accepts a Headers instance", async () => {
		const headers = new Headers();
		headers.append("x-test", "1");
		const storage = createRequestCookieStorage(headers);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});

	it("accepts a bare cookie header string", async () => {
		const storage = createRequestCookieStorage("qb_cart_id=abc");
		expect(await storage.get("qb_cart_id")).toBe("abc");
	});

	it("returns null for everything when there is no cookie header", async () => {
		const storage = createRequestCookieStorage(null);
		expect(await storage.get("qb_cart_id")).toBeNull();
	});
});

describe("createCookieStorage", () => {
	it("drives an injected async accessor", async () => {
		const jar = new Map<string, string>([["qb_cart_id", "cart-1"]]);
		const storage = createCookieStorage({
			get: async (name) => jar.get(name) ?? null,
			set: async (name, value) => {
				jar.set(name, value);
			},
			remove: async (name) => {
				jar.delete(name);
			},
		});

		expect(await storage.get("qb_cart_id")).toBe("cart-1");
		await storage.set("qb_cart_id", "cart-2");
		expect(jar.get("qb_cart_id")).toBe("cart-2");
		await storage.remove("qb_cart_id");
		expect(jar.has("qb_cart_id")).toBe(false);
	});

	it("silently drops writes on a read-only accessor (an RSC cannot set cookies)", async () => {
		const storage = createCookieStorage({ get: () => "cart-1" });
		await expect(storage.set("qb_cart_id", "cart-2")).resolves.toBeUndefined();
		expect(await storage.get("qb_cart_id")).toBe("cart-1");
	});

	it("expires via set when the accessor has no remove", async () => {
		const set = vi.fn();
		const storage = createCookieStorage({ get: () => null, set });
		await storage.remove("qb_cart_id");
		expect(set).toHaveBeenCalledWith(
			"qb_cart_id",
			"",
			expect.objectContaining({ maxAge: 0 }),
		);
	});
});

describe("resolveStorage", () => {
	beforeEach(() => {
		// biome-ignore lint/suspicious/noDocumentCookie: resetting the jar between cases.
		document.cookie = "";
	});

	it("prefers an injected accessor even in a browser", () => {
		const actual = resolveStorage({ cookies: { get: () => null } });
		expect(actual.kind).toBe("cookie");
	});

	it("uses document cookies in a browser with no accessor", () => {
		const actual = resolveStorage({});
		expect(actual.kind).toBe("cookie");
	});

	it("honours an explicit preference", () => {
		expect(resolveStorage({ preference: "memory" }).kind).toBe("memory");
		expect(resolveStorage({ preference: "localStorage" }).kind).toBe(
			"localStorage",
		);
	});

	it("passes a custom adapter straight through", () => {
		const custom = createMemoryStorage();
		expect(resolveStorage({ preference: custom })).toBe(custom);
	});

	it("round-trips through document.cookie", async () => {
		const storage = resolveStorage({ preference: "cookie" });
		await storage.set("qb_cart_id", "cart-7", { ttlSeconds: 600 });
		expect(await storage.get("qb_cart_id")).toBe("cart-7");
		await storage.remove("qb_cart_id");
		expect(await storage.get("qb_cart_id")).toBeNull();
	});
});
