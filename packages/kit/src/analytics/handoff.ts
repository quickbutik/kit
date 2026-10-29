import { consentCategoriesParam } from "../consent/consent-mode.js";
import { undecidedConsent } from "../consent/cookie.js";
import type { ConsentStore } from "../consent/store.js";
import type { ConsentState } from "../consent/types.js";
import { parseCookieHeader } from "../runtime/cookies.js";
import type { Analytics } from "./analytics.js";

/**
 * The Google Analytics ids a page's `_ga` / `_ga_<property>` cookies carry,
 * for stitching the storefront session to the checkout's. Parsed the same
 * way as on the hosted storefront.
 */
export interface GaLink {
	clientId: string | null;
	sessionId: string | null;
}

export function readGaCookies(
	cookieHeader?: string | null | CookieList,
): GaLink {
	const cookies =
		typeof cookieHeader === "object" && cookieHeader !== null
			? Object.fromEntries(cookieHeader.map(({ name, value }) => [name, value]))
			: parseCookieHeader(
					cookieHeader ??
						(typeof document !== "undefined" ? document.cookie : ""),
				);
	let clientId: string | null = null;
	let sessionId: string | null = null;
	const ga = cookies._ga;
	if (ga) {
		const match = /^GA\d+\.\d+\.(.+)$/.exec(ga);
		if (match?.[1]) clientId = match[1];
	}
	for (const [name, value] of Object.entries(cookies)) {
		if (!name.startsWith("_ga_")) continue;
		const match = /^GS\d+\.\d+\.s?(\d+)/.exec(value);
		if (match?.[1]) {
			sessionId = match[1];
			break;
		}
	}
	return { clientId, sessionId };
}

/** Cookies as a list of pairs: what Next's `cookies().getAll()` returns. */
export type CookieList = ReadonlyArray<{ name: string; value: string }>;

export interface HandoffParamsOptions {
	/**
	 * The cookies to read the GA ids from: a `Cookie:` header, or the
	 * `{ name, value }` list a framework's cookie jar returns. Defaults to
	 * `document.cookie` in a browser; pass the request's on a server.
	 */
	cookies?: string | null | CookieList;
	/**
	 * False omits `consentCategories`, so the checkout tracks ungated.
	 * Default true.
	 */
	requireConsent?: boolean;
	/** Set false to leave the GA cookies alone. Default true. */
	linkGa?: boolean;
}

/**
 * The hosted checkout URL with the shopper's consent
 * (`consentCategories=analytics,marketing`) and, when analytics is allowed,
 * the GA session link (`gaClientId`, `gaSessionId`) appended. The checkout
 * sets Consent Mode from them before any tag loads.
 *
 * An undecided shopper is sent as an empty `consentCategories=`, so the
 * checkout runs denied; only `requireConsent: false` omits it. The legacy
 * hosted checkout ignores these parameters.
 *
 * Idempotent, so a URL decorated on the server can be decorated again in the
 * browser. Returns the URL untouched when it cannot be parsed.
 */
export function appendCheckoutHandoffParams(
	url: string,
	consent: ConsentState | null | undefined,
	options: HandoffParamsOptions = {},
): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	const requireConsent = options.requireConsent !== false;
	const state = requireConsent ? (consent ?? undecidedConsent()) : null;
	const categories = consentCategoriesParam(state);
	if (categories !== null) {
		parsed.searchParams.set("consentCategories", categories);
	}
	const analyticsAllowed = state === null || state.analytics;
	// Cleared first, so ids from an earlier decision never linger.
	parsed.searchParams.delete("gaClientId");
	parsed.searchParams.delete("gaSessionId");
	if (options.linkGa !== false && analyticsAllowed) {
		const link = readGaCookies(options.cookies);
		if (link.clientId) parsed.searchParams.set("gaClientId", link.clientId);
		if (link.sessionId) parsed.searchParams.set("gaSessionId", link.sessionId);
	}
	return parsed.toString();
}

/**
 * `appendCheckoutHandoffParams` from a page's consent store and analytics
 * hub. With neither configured the URL is returned unchanged. The decision is
 * read from the store at call time, not from the last render.
 */
export function checkoutHandoffUrl(
	url: string,
	consent: ConsentStore | null | undefined,
	analytics: Pick<Analytics, "requireConsent"> | null | undefined,
): string {
	if (!consent && !analytics) return url;
	return appendCheckoutHandoffParams(url, consent?.getState() ?? null, {
		requireConsent: analytics?.requireConsent ?? true,
	});
}
