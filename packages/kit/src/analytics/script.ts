import { isBrowser } from "../runtime/detect.js";

/** Marks every script tag the kit's destinations add, so a page (or a test) can find them. */
export const ANALYTICS_SCRIPT_ATTR = "data-qb-analytics";

const injected = new Set<string>();

/**
 * Add an `async` vendor script to `<head>`, once per `src` for the lifetime
 * of the page; a no-op outside a browser. The tag carries
 * `data-qb-analytics="<id>"`. A page with a `script-src` CSP must allow the
 * vendor hosts it opts into.
 */
export function injectScript(
	src: string,
	id: string,
): HTMLScriptElement | null {
	if (!isBrowser()) return null;
	if (injected.has(src)) return null;
	// Reuse a tag already on the page; a second would double every event.
	for (const existing of Array.from(document.scripts)) {
		if (existing.getAttribute("src") === src) {
			injected.add(src);
			return existing;
		}
	}
	const script = document.createElement("script");
	script.async = true;
	script.src = src;
	script.setAttribute(ANALYTICS_SCRIPT_ATTR, id);
	(document.head ?? document.documentElement).appendChild(script);
	injected.add(src);
	return script;
}

/** Forget what was injected. For tests, which reset the document between cases. */
export function resetInjectedScripts(): void {
	injected.clear();
}
