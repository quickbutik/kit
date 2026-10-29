import { appendCheckoutHandoffParams } from "../../analytics/handoff.js";
import {
	parseConsentCookieValue,
	readConsentCookie,
	undecidedConsent,
} from "../../consent/cookie.js";
import type { ConsentState } from "../../consent/types.js";
import type { ResolvedShopkitConfig } from "../config.js";

/**
 * The shopper's consent decision as this client sees it, and the settings
 * every part of the kit has to agree on to read it.
 *
 * Not a request to the platform: the decision lives in the `qb_consent`
 * cookie on the storefront's own origin, so on a server it is read through
 * the same `cookies` accessor the cart id is, and in a browser from
 * `document.cookie`.
 *
 * ```ts
 * // A Next.js layout: no banner flash for a shopper who already decided.
 * const shopkit = await readOnlyShopkit()
 * const consent = await shopkit.consent.read()
 * <ShopkitProvider config={config} consent={{ initialState: consent }}>
 * ```
 */
export class ConsentResource {
	constructor(private readonly config: ResolvedShopkitConfig) {}

	/** False when the config says `consent: false`. */
	get enabled(): boolean {
		return this.config.consent.enabled;
	}

	/** The cookie-policy revision a stored decision must match. */
	get revision(): number {
		return this.config.consent.revision;
	}

	/** The cookie the decision is stored in. */
	get cookieName(): string {
		return this.config.consent.cookieName;
	}

	/**
	 * The decision, from this client's cookies: the `cookies` accessor when
	 * one was configured, else `document.cookie`, else undecided. A decision
	 * made under another revision, or a cookie that is not one, reads as
	 * undecided.
	 */
	async read(): Promise<ConsentState> {
		const accessor = this.config.cookies;
		if (accessor) {
			const raw = await accessor.get(this.cookieName);
			return parseConsentCookieValue(raw ?? null, this.revision);
		}
		if (typeof document !== "undefined") {
			return readConsentCookie(document.cookie, {
				cookieName: this.cookieName,
				revision: this.revision,
			});
		}
		return undecidedConsent(this.revision);
	}

	/**
	 * A hosted checkout URL with the decision from this client's cookie
	 * accessor on it (`consentCategories`, plus `gaClientId` / `gaSessionId`
	 * when analytics is granted and the accessor has `getAll()`).
	 *
	 * What `checkout.start()` applies on a server client. The URL comes back
	 * untouched when consent is off or the client has no cookie accessor:
	 * a browser client's handoff is decorated by the React hooks and the
	 * elements instead, from the live consent store.
	 */
	async decorateHandoff(url: string): Promise<string> {
		const accessor = this.config.cookies;
		if (!accessor || !this.enabled) return url;
		const state = await this.read();
		const cookies =
			state.analytics && accessor.getAll ? await accessor.getAll() : null;
		return appendCheckoutHandoffParams(url, state, {
			cookies,
			linkGa: cookies !== null,
		});
	}
}
