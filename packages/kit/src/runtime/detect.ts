/**
 * Where this code is executing. `browser` requires both `window` and
 * `document`, so a worker counts as `server`.
 */
export type ShopkitRuntime = "browser" | "server";

/** True in a DOM-bearing browser context. */
export function isBrowser(): boolean {
	return (
		typeof window !== "undefined" && typeof window.document !== "undefined"
	);
}

/**
 * True when `document.cookie` is usable. On the server, inject an accessor
 * instead (see `createCookieStorage`).
 */
export function hasDocumentCookies(): boolean {
	if (!isBrowser()) return false;
	return typeof document.cookie === "string";
}

/**
 * True when `localStorage` is present and usable. Probed, because Safari
 * private mode and blocked cookies expose it but throw on write, and some
 * partitioned iframes throw on access.
 */
export function hasLocalStorage(): boolean {
	if (!isBrowser()) return false;
	try {
		const probe = "__qb_shopkit_probe__";
		window.localStorage.setItem(probe, probe);
		window.localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

/**
 * True when this page can navigate its own top window: it is the top window,
 * or framed same-origin. False when framed cross-origin or sandboxed (reading
 * `top.location` throws).
 *
 * The embedded checkout uses this: redirect payment methods navigate the top
 * window, so a page that cannot (e.g. a site builder's preview pane) falls
 * back to the redirect checkout.
 */
export function canNavigateTopWindow(): boolean {
	if (typeof window === "undefined") return false;
	try {
		if (window.top === window.self) return true;
		return typeof window.top?.location.href === "string";
	} catch {
		return false;
	}
}

export function detectRuntime(): ShopkitRuntime {
	return isBrowser() ? "browser" : "server";
}
