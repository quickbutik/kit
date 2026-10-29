/**
 * Cookie consent, framework-free.
 *
 * ```ts
 * import { ConsentStore, readConsentCookie } from "@quickbutik/kit"
 *
 * // Browser: reads the decision from the cookie, writes it back on save.
 * const consent = new ConsentStore({ revision: 2 })
 * consent.subscribe(() => render(consent.getSnapshot()))
 * consent.allows("marketing") // false until the shopper says yes
 *
 * // Server: the same decision, from the request.
 * const state = readConsentCookie(request.headers.get("cookie"), { revision: 2 })
 * ```
 *
 * `@quickbutik/kit/react` and `@quickbutik/kit/elements` provide banner,
 * settings and gate components on top of the store.
 */

export type { ConsentModeSignals, ConsentModeValue } from "./consent-mode.js";
export { consentCategoriesParam, consentModeSignals } from "./consent-mode.js";
export type {
	ConsentCookieOptions,
	ConsentCookieWriteOptions,
} from "./cookie.js";
export {
	clearConsentCookie,
	DEFAULT_CONSENT_COOKIE,
	DEFAULT_CONSENT_MAX_AGE_DAYS,
	DEFAULT_CONSENT_REVISION,
	parseConsentCookieValue,
	readConsentCookie,
	serializeConsentState,
	undecidedConsent,
	writeConsentCookie,
} from "./cookie.js";
export type { ConsentLabels } from "./labels.js";
export {
	CONSENT_LABEL_LANGUAGES,
	consentLabels,
	resolveLanguage,
} from "./labels.js";
export type { ConsentStoreOptions } from "./store.js";
export { CONSENT_EVENT, ConsentStore } from "./store.js";
export {
	CONSENT_STYLE_ID,
	CONSENT_STYLES,
	injectConsentStyles,
} from "./styles.js";
export type {
	ConsentCategory,
	ConsentChoice,
	ConsentSnapshot,
	ConsentState,
	ConsentStatus,
	OptionalConsentCategory,
} from "./types.js";
