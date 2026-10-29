import { ConsentStore, type ConsentStoreOptions } from "../consent/store.js";

/**
 * The page's consent store: one per page, not per shop, since the shopper
 * decides once for the origin. Created lazily with the defaults (the
 * `qb_consent` cookie) unless `configure({ consent })` or `configureConsent()`
 * supplies one, e.g. with a policy revision, a shared cookie domain, or driven
 * by a third-party consent platform (`persist: false` + `save()`).
 */
let ambient: ConsentStore | null = null;

/**
 * Configure the consent store the elements share. Pass the options for a new
 * store, or a store you already hold (one a React tree also uses, say). Call
 * it before `defineElements()`: an element that has already started keeps
 * the store it found.
 */
export function configureConsent(
	options: ConsentStoreOptions | ConsentStore = {},
): ConsentStore {
	ambient =
		options instanceof ConsentStore ? options : new ConsentStore(options);
	return ambient;
}

/** The ambient consent store, or null when nothing has created one yet. */
export function getAmbientConsent(): ConsentStore | null {
	return ambient;
}

/** The ambient consent store, created with the defaults if there is none. */
export function requireAmbientConsent(): ConsentStore {
	if (!ambient) ambient = new ConsentStore();
	return ambient;
}

/**
 * Whether the page turned consent off (`configure({ consent: false })`,
 * `data-consent="false"`). The handoff elements then leave checkout URLs
 * alone, and no banner is mounted on the page's behalf.
 */
let disabled = false;

/** @internal Set by `configure()`. */
export function setConsentDisabled(value: boolean): void {
	disabled = value;
	if (value) disableAutoBanner();
}

export function isConsentDisabled(): boolean {
	return disabled;
}

/** Marks the banner the kit mounted itself, as opposed to one in the page. */
export const AUTO_BANNER_ATTR = "data-qb-auto";

/** What the auto-mounted `<qb-consent-banner>` is given. */
export interface AutoBannerOptions {
	lang?: string;
	privacyPolicyUrl?: string;
	unstyled?: boolean;
}

let bannerTag = "qb-consent-banner";
let autoBanner: AutoBannerOptions | null = null;

/** @internal `defineElements()` reports the tag it registered the banner under. */
export function setConsentBannerTag(tag: string): void {
	bannerTag = tag;
}

/**
 * Ask for a default `<qb-consent-banner>`, appended to `<body>` once the
 * document is parsed unless the page has one. A banner the page places
 * itself, then or later, always wins.
 *
 * Requests merge: `scope: "page"` (from `configure()` and the script tag)
 * overrides existing options, while a `"shop"` request only fills gaps and
 * never re-enables a banner turned off with `disableAutoBanner()`.
 */
export function requestAutoBanner(
	options: AutoBannerOptions = {},
	{ scope = "shop" }: { scope?: "page" | "shop" } = {},
): void {
	const given = defined(options);
	if (scope === "page") {
		bannerOff = false;
		autoBanner = { ...(autoBanner ?? {}), ...given };
	} else {
		if (bannerOff) return;
		autoBanner = { ...given, ...(autoBanner ?? {}) };
	}
	if (typeof document === "undefined") return;
	const existing = document.querySelector(`${bannerTag}[${AUTO_BANNER_ATTR}]`);
	if (existing) {
		applyAutoBannerOptions(existing, autoBanner);
		return;
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", mountAutoBanner, {
			once: true,
		});
	} else {
		queueMicrotask(mountAutoBanner);
	}
}

/**
 * The page wants no automatic banner (`configure({ consent: { banner: false } })`,
 * `data-consent-banner="false"`): take down the one mounted, and refuse a
 * `<qb-shop>`'s request for another until the page asks again.
 */
export function disableAutoBanner(): void {
	bannerOff = true;
	cancelAutoBanner();
}

/** Withdraw the request, and take down the banner it mounted. */
export function cancelAutoBanner(): void {
	autoBanner = null;
	if (typeof document === "undefined") return;
	for (const banner of document.querySelectorAll(`[${AUTO_BANNER_ATTR}]`)) {
		banner.remove();
	}
}

let bannerOff = false;

function defined(options: AutoBannerOptions): AutoBannerOptions {
	const out: AutoBannerOptions = {};
	if (options.lang !== undefined) out.lang = options.lang;
	if (options.privacyPolicyUrl !== undefined) {
		out.privacyPolicyUrl = options.privacyPolicyUrl;
	}
	if (options.unstyled !== undefined) out.unstyled = options.unstyled;
	return out;
}

function mountAutoBanner(): void {
	const options = autoBanner;
	if (!options || !document.body || document.querySelector(bannerTag)) return;
	const banner = document.createElement(bannerTag);
	banner.setAttribute(AUTO_BANNER_ATTR, "");
	applyAutoBannerOptions(banner, options);
	document.body.append(banner);
}

function applyAutoBannerOptions(
	banner: Element,
	options: AutoBannerOptions,
): void {
	setOrRemove(banner, "lang", options.lang);
	setOrRemove(banner, "privacy-policy-url", options.privacyPolicyUrl);
	setOrRemove(banner, "unstyled", options.unstyled ? "" : undefined);
}

function setOrRemove(
	element: Element,
	name: string,
	value: string | undefined,
): void {
	if (value === undefined) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

/** Forget the ambient store. For tests, and for a hard teardown. */
export function resetAmbientConsent(): void {
	ambient = null;
	disabled = false;
	bannerOff = false;
	cancelAutoBanner();
}
