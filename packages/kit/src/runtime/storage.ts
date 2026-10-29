import type { CookieAttributes } from "./cookies.js";
import {
	deleteDocumentCookie,
	parseCookieHeader,
	readDocumentCookie,
	serializeCookie,
	writeDocumentCookie,
} from "./cookies.js";
import { hasDocumentCookies, hasLocalStorage, isBrowser } from "./detect.js";

export type MaybePromise<T> = T | Promise<T>;

/**
 * Anything a `Cookie:` header can be read from: a request, a `Headers`, or the
 * raw header string.
 */
export type CookieHeaderSource =
	| string
	| Headers
	| { headers: { get(name: string): string | null } }
	| null
	| undefined;

function readCookieHeader(source: CookieHeaderSource): string | null {
	if (source == null) return null;
	if (typeof source === "string") return source;
	if (typeof (source as Headers).get === "function") {
		return (source as Headers).get("cookie");
	}
	const withHeaders = source as {
		headers?: { get(name: string): string | null };
	};
	return withHeaders.headers?.get("cookie") ?? null;
}

/**
 * Where shopkit keeps the ids it must remember between requests: the cart id,
 * the checkout session id and the cart's numeric store id. Every method may
 * return a promise (Next.js's `cookies()` is async).
 */
export interface StorageAdapter {
	/** Short name used in error messages and `client.runtime.storage`. */
	readonly kind: string;
	/**
	 * `false` when writes cannot persist past this request (e.g. in a React
	 * Server Component). Such a client never renews a customer session, since
	 * the rotated refresh token would be lost. Omitted means writable.
	 */
	readonly writable?: boolean;
	get(key: string): MaybePromise<string | null>;
	set(
		key: string,
		value: string,
		options?: StorageSetOptions,
	): MaybePromise<void>;
	remove(key: string): MaybePromise<void>;
}

export interface StorageSetOptions {
	/** Lifetime in seconds. Adapters that cannot expire values ignore it. */
	ttlSeconds?: number;
}

/**
 * How the SDK should persist ids.
 *
 * - `"auto"` (default) — in a browser: cookies when writable, else
 *   `localStorage`, else memory. On a server: the `cookies` accessor when one
 *   was supplied, else memory. Cookies come first so a server render sees the
 *   same cart as the browser.
 * - `"cookie"` / `"localStorage"` / `"memory"` — force one.
 * - a `StorageAdapter` — bring your own (Redis, KV, signed cookie, …).
 */
export type StoragePreference =
	| "auto"
	| "cookie"
	| "localStorage"
	| "memory"
	| StorageAdapter;

/**
 * The cookie operations shopkit needs from a server framework (Next's
 * `cookies()`, a Hono context, an Express `req`/`res` pair). `set`/`remove`
 * are optional; without them writes are silently dropped, as in a React
 * Server Component.
 */
export interface CookieAccessor {
	get(name: string): MaybePromise<string | null | undefined>;
	set?(
		name: string,
		value: string,
		attributes: CookieAttributes,
	): MaybePromise<void>;
	remove?(name: string, attributes: CookieAttributes): MaybePromise<void>;
	/**
	 * Every cookie on the request, as Next's `cookies().getAll()` returns them.
	 * Used only to forward the GA `_ga_<property>` cookies to the hosted
	 * checkout; without it the GA ids are not forwarded.
	 */
	getAll?(): MaybePromise<ReadonlyArray<{ name: string; value: string }>>;
}

/** In-process map. The always-available fallback; never survives a restart. */
export function createMemoryStorage(): StorageAdapter {
	const store = new Map<string, string>();
	return {
		kind: "memory",
		get: (key) => store.get(key) ?? null,
		set: (key, value) => {
			store.set(key, value);
		},
		remove: (key) => {
			store.delete(key);
		},
	};
}

/** `window.localStorage`, with every access guarded (see `hasLocalStorage`). */
export function createLocalStorage(): StorageAdapter {
	return {
		kind: "localStorage",
		get: (key) => {
			try {
				return emptyToNull(window.localStorage.getItem(key));
			} catch {
				return null;
			}
		},
		set: (key, value) => {
			try {
				window.localStorage.setItem(key, value);
			} catch {
				// Quota exceeded or blocked: losing the cart id is recoverable.
			}
		},
		remove: (key) => {
			try {
				window.localStorage.removeItem(key);
			} catch {
				// As in `set`.
			}
		},
	};
}

/** Treat an empty value as absent: an expired cookie can linger as `name=`. */
function emptyToNull(value: string | null): string | null {
	if (value === null) return null;
	return value.length > 0 ? value : null;
}

/** `document.cookie`. Browser-only; readable by the server on the next request. */
export function createDocumentCookieStorage(
	attributes: CookieAttributes = {},
): StorageAdapter {
	return {
		kind: "cookie",
		get: (key) => emptyToNull(readDocumentCookie(key)),
		set: (key, value, options) => {
			writeDocumentCookie(key, value, {
				...attributes,
				maxAge: options?.ttlSeconds,
			});
		},
		remove: (key) => {
			deleteDocumentCookie(key, attributes);
		},
	};
}

/**
 * Server-side cookie storage driven by an injected accessor.
 *
 * ```ts
 * // Next.js app router
 * import { cookies } from "next/headers"
 * createCookieStorage({
 *   get: async (name) => (await cookies()).get(name)?.value ?? null,
 *   set: async (name, value, attrs) => { (await cookies()).set(name, value, attrs) },
 *   remove: async (name) => { (await cookies()).delete(name) },
 * })
 * ```
 */
export function createCookieStorage(
	accessor: CookieAccessor,
	attributes: CookieAttributes = {},
): StorageAdapter {
	return {
		kind: "cookie",
		writable: accessor.set !== undefined,
		get: async (key) => emptyToNull((await accessor.get(key)) ?? null),
		set: async (key, value, options) => {
			if (!accessor.set) return;
			await accessor.set(key, value, {
				...attributes,
				maxAge: options?.ttlSeconds,
			});
		},
		remove: async (key) => {
			if (accessor.remove) {
				await accessor.remove(key, attributes);
				return;
			}
			if (accessor.set) {
				await accessor.set(key, "", { ...attributes, maxAge: 0 });
			}
		},
	};
}

/**
 * Read cookies straight off a `Request` (or any `Headers`), optionally
 * collecting writes as `Set-Cookie` strings for the caller to attach to its
 * response. Framework-free (Astro, TanStack Start, `fetch` handlers, Workers).
 *
 * ```ts
 * const setCookies: string[] = []
 * const storage = createRequestCookieStorage(request, { collect: setCookies })
 * // … after rendering:
 * for (const c of setCookies) headers.append("set-cookie", c)
 * ```
 */
export function createRequestCookieStorage(
	source: CookieHeaderSource,
	options: { collect?: string[]; attributes?: CookieAttributes } = {},
): StorageAdapter {
	const header = readCookieHeader(source);
	const jar = parseCookieHeader(header);
	const attributes = options.attributes ?? {};
	return {
		kind: "cookie",
		writable: options.collect !== undefined,
		get: (key) => emptyToNull(jar[key] ?? null),
		set: (key, value, setOptions) => {
			jar[key] = value;
			options.collect?.push(
				serializeCookie(key, value, {
					...attributes,
					maxAge: setOptions?.ttlSeconds,
				}),
			);
		},
		remove: (key) => {
			delete jar[key];
			options.collect?.push(
				serializeCookie(key, "", { ...attributes, maxAge: 0 }),
			);
		},
	};
}

/**
 * Turn a {@link StoragePreference} into a concrete adapter for the current
 * runtime. Never throws: an unusable preference falls back to memory.
 */
export function resolveStorage(options: {
	preference?: StoragePreference;
	cookies?: CookieAccessor;
	cookieAttributes?: CookieAttributes;
}): StorageAdapter {
	const { preference = "auto", cookies, cookieAttributes } = options;

	if (typeof preference === "object") return preference;

	if (preference === "memory") return createMemoryStorage();

	if (preference === "localStorage") {
		return hasLocalStorage() ? createLocalStorage() : createMemoryStorage();
	}

	if (preference === "cookie") {
		if (cookies) return createCookieStorage(cookies, cookieAttributes);
		if (hasDocumentCookies())
			return createDocumentCookieStorage(cookieAttributes);
		return createMemoryStorage();
	}

	// "auto": an explicitly supplied accessor always wins.
	if (cookies) return createCookieStorage(cookies, cookieAttributes);
	if (!isBrowser()) return createMemoryStorage();
	if (hasDocumentCookies())
		return createDocumentCookieStorage(cookieAttributes);
	if (hasLocalStorage()) return createLocalStorage();
	return createMemoryStorage();
}
