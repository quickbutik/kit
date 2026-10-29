import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CONSENT_EVENT,
	CONSENT_LABEL_LANGUAGES,
	type ConsentState,
	ConsentStore,
	clearConsentCookie,
	consentCategoriesParam,
	consentLabels,
	consentModeSignals,
	DEFAULT_CONSENT_COOKIE,
	parseConsentCookieValue,
	readConsentCookie,
	resolveLanguage,
	serializeConsentState,
	undecidedConsent,
	writeConsentCookie,
} from "../src/consent/index.js";
import { parseCookieHeader } from "../src/runtime/cookies.js";

const DECIDED_AT = "2026-10-01T10:00:00.000Z";

function decided(overrides: Partial<ConsentState> = {}): ConsentState {
	return {
		status: "decided",
		analytics: true,
		marketing: false,
		decidedAt: DECIDED_AT,
		revision: 1,
		...overrides,
	};
}

function clearCookies(): void {
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

/**
 * The raw value of one cookie in the jar, "" when absent. happy-dom keeps an
 * expired cookie in `document.cookie` as `name=` rather than dropping it, so
 * presence is judged by the value, never by the raw string.
 */
function cookieValue(name: string): string {
	return parseCookieHeader(document.cookie)[name] ?? "";
}

/** The cookies that actually hold a value. */
function storedCookieNames(): string[] {
	return Object.entries(parseCookieHeader(document.cookie))
		.filter(([, value]) => value !== "")
		.map(([name]) => name);
}

beforeEach(() => {
	clearCookies();
	document.documentElement.removeAttribute("lang");
});

describe("parseConsentCookieValue / readConsentCookie", () => {
	it("round-trips a decided state through serializeConsentState", () => {
		const inputState = decided();

		const actual = parseConsentCookieValue(serializeConsentState(inputState));

		expect(actual).toEqual(inputState);
	});

	it("keeps both flags, whatever they are", () => {
		const inputState = decided({ analytics: false, marketing: true });
		expect(parseConsentCookieValue(serializeConsentState(inputState))).toEqual(
			inputState,
		);
	});

	it("stamps decidedAt when a decided state carries none", () => {
		const actual = parseConsentCookieValue(
			serializeConsentState(decided({ decidedAt: null })),
		);
		expect(actual.status).toBe("decided");
		expect(typeof actual.decidedAt).toBe("string");
	});

	it("reads a decision for another revision as undecided for this one", () => {
		const serialized = serializeConsentState(decided({ revision: 1 }));

		const actual = parseConsentCookieValue(serialized, 2);

		expect(actual).toEqual(undecidedConsent(2));
	});

	it("reads malformed JSON as undecided", () => {
		expect(parseConsentCookieValue("{not json")).toEqual(undecidedConsent());
	});

	it("reads a value with missing or mistyped keys as undecided", () => {
		expect(
			parseConsentCookieValue(JSON.stringify({ rev: 1, analytics: true })),
		).toEqual(undecidedConsent());
		expect(
			parseConsentCookieValue(
				JSON.stringify({
					rev: "1",
					analytics: true,
					marketing: false,
					decidedAt: DECIDED_AT,
				}),
			),
		).toEqual(undecidedConsent());
		expect(parseConsentCookieValue(JSON.stringify(null))).toEqual(
			undecidedConsent(),
		);
		expect(parseConsentCookieValue("[1,2]")).toEqual(undecidedConsent());
	});

	it("reads an absent value as undecided", () => {
		expect(parseConsentCookieValue(null)).toEqual(undecidedConsent());
		expect(parseConsentCookieValue(undefined)).toEqual(undecidedConsent());
		expect(parseConsentCookieValue("")).toEqual(undecidedConsent());
	});

	it("reads an absent cookie as undecided", () => {
		expect(readConsentCookie(null)).toEqual(undecidedConsent());
		expect(readConsentCookie("")).toEqual(undecidedConsent());
		expect(readConsentCookie("qb_cart_id=cart-1")).toEqual(undecidedConsent());
	});

	it("reads the decision out of a Cookie header", () => {
		const inputState = decided();
		const header = `qb_cart_id=cart-1; ${DEFAULT_CONSENT_COOKIE}=${encodeURIComponent(serializeConsentState(inputState))}`;

		expect(readConsentCookie(header)).toEqual(inputState);
	});

	it("honours the cookie name option", () => {
		const inputState = decided();
		const header = `my_consent=${encodeURIComponent(serializeConsentState(inputState))}`;

		expect(readConsentCookie(header, { cookieName: "my_consent" })).toEqual(
			inputState,
		);
		expect(readConsentCookie(header)).toEqual(undecidedConsent());
	});

	it("honours the revision option", () => {
		const header = `${DEFAULT_CONSENT_COOKIE}=${encodeURIComponent(serializeConsentState(decided({ revision: 3 })))}`;

		expect(readConsentCookie(header, { revision: 3 }).status).toBe("decided");
		expect(readConsentCookie(header).status).toBe("undecided");
	});

	it("refuses to serialize an undecided state", () => {
		expect(() => serializeConsentState(undecidedConsent())).toThrow(
			/only a decided consent state/,
		);
	});
});

describe("writeConsentCookie / clearConsentCookie", () => {
	it("writes qb_consent to document.cookie", () => {
		const inputState = decided();

		writeConsentCookie(inputState);

		expect(cookieValue(DEFAULT_CONSENT_COOKIE)).not.toBe("");
		expect(readConsentCookie(document.cookie)).toEqual(inputState);
	});

	it("removes the cookie again", () => {
		writeConsentCookie(decided());

		clearConsentCookie();

		expect(cookieValue(DEFAULT_CONSENT_COOKIE)).toBe("");
		expect(readConsentCookie(document.cookie)).toEqual(undecidedConsent());
	});

	it("writes and clears under a custom cookie name", () => {
		const inputState = decided();

		writeConsentCookie(inputState, { cookieName: "my_consent" });
		expect(
			readConsentCookie(document.cookie, { cookieName: "my_consent" }),
		).toEqual(inputState);
		expect(readConsentCookie(document.cookie)).toEqual(undecidedConsent());

		clearConsentCookie({ cookieName: "my_consent" });
		expect(cookieValue("my_consent")).toBe("");
	});
});

describe("ConsentStore", () => {
	it("starts from the cookie in a browser", () => {
		writeConsentCookie(decided({ analytics: true, marketing: true }));

		const store = new ConsentStore();

		expect(store.getSnapshot()).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: true,
			decidedAt: DECIDED_AT,
			open: false,
		});
	});

	it("starts undecided when there is no cookie", () => {
		const store = new ConsentStore();
		expect(store.getSnapshot()).toEqual({ ...undecidedConsent(), open: false });
	});

	it("ignores a cookie written against another revision", () => {
		writeConsentCookie(decided({ revision: 1 }));

		const store = new ConsentStore({ revision: 2 });

		expect(store.getState()).toEqual(undecidedConsent(2));
		expect(store.revision).toBe(2);
	});

	it("lets initialState win over the cookie", () => {
		writeConsentCookie(decided({ analytics: true, marketing: true }));

		const store = new ConsentStore({
			initialState: decided({ analytics: false, marketing: false }),
		});

		expect(store.getState()).toEqual(
			decided({ analytics: false, marketing: false }),
		);
	});

	it("starts undecided without reading the cookie when initialState is null", () => {
		writeConsentCookie(decided({ analytics: true, marketing: true }));

		const store = new ConsentStore({ initialState: null });

		expect(store.getState()).toEqual(undecidedConsent());
	});

	it("acceptAll decides both categories, persists and closes the panel", () => {
		const store = new ConsentStore({ initialState: null });
		store.openSettings();

		store.acceptAll();

		const actual = store.getSnapshot();
		expect(actual.status).toBe("decided");
		expect(actual.analytics).toBe(true);
		expect(actual.marketing).toBe(true);
		expect(actual.open).toBe(false);
		expect(typeof actual.decidedAt).toBe("string");
		expect(Number.isNaN(Date.parse(actual.decidedAt ?? ""))).toBe(false);
		expect(readConsentCookie(document.cookie)).toEqual(store.getState());
	});

	it("rejectAll decides against both categories and persists that too", () => {
		const store = new ConsentStore({ initialState: null });

		store.rejectAll();

		expect(store.getSnapshot()).toMatchObject({
			status: "decided",
			analytics: false,
			marketing: false,
			open: false,
		});
		expect(readConsentCookie(document.cookie)).toMatchObject({
			status: "decided",
			analytics: false,
			marketing: false,
		});
	});

	it("save records a mixed choice and coerces the flags to booleans", () => {
		const store = new ConsentStore({ initialState: null });
		store.openSettings();

		store.save({ analytics: true, marketing: false });

		expect(store.getSnapshot()).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: false,
			open: false,
		});
		expect(store.allows("analytics")).toBe(true);
		expect(store.allows("marketing")).toBe(false);
	});

	it("allows necessary always and nothing optional while undecided", () => {
		const store = new ConsentStore({ initialState: null });

		expect(store.allows("necessary")).toBe(true);
		expect(store.allows("analytics")).toBe(false);
		expect(store.allows("marketing")).toBe(false);

		store.acceptAll();

		expect(store.allows("necessary")).toBe(true);
		expect(store.allows("analytics")).toBe(true);
		expect(store.allows("marketing")).toBe(true);
	});

	it("notifies subscribers on every decision", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		const mockListener = vi.fn();
		store.subscribe(mockListener);

		store.acceptAll();
		store.rejectAll();

		expect(mockListener).toHaveBeenCalledTimes(2);
	});

	it("replaces the snapshot object on change so useSyncExternalStore sees it", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		const before = store.getSnapshot();

		store.acceptAll();

		expect(store.getSnapshot()).not.toBe(before);
		expect(store.getSnapshot()).toBe(store.getSnapshot());
	});

	it("openSettings / closeSettings only notify when the flag actually changes", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		const mockListener = vi.fn();
		store.subscribe(mockListener);

		store.openSettings();
		store.openSettings();
		expect(mockListener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().open).toBe(true);

		store.closeSettings();
		store.closeSettings();
		expect(mockListener).toHaveBeenCalledTimes(2);
		expect(store.getSnapshot().open).toBe(false);
	});

	it("unsubscribe stops the notifications", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		const mockListener = vi.fn();
		const unsubscribe = store.subscribe(mockListener);

		unsubscribe();
		store.acceptAll();

		expect(mockListener).not.toHaveBeenCalled();
	});

	it("reset forgets the decision and the cookie", () => {
		const store = new ConsentStore({ initialState: null });
		store.acceptAll();
		expect(cookieValue(DEFAULT_CONSENT_COOKIE)).not.toBe("");

		store.reset();

		expect(store.getSnapshot()).toEqual({ ...undecidedConsent(), open: false });
		expect(cookieValue(DEFAULT_CONSENT_COOKIE)).toBe("");
		expect(store.allows("marketing")).toBe(false);
	});

	it("writes nothing with persist: false", () => {
		const store = new ConsentStore({ persist: false, initialState: null });

		store.acceptAll();
		expect(storedCookieNames()).toEqual([]);

		store.reset();
		expect(storedCookieNames()).toEqual([]);
	});

	it("passes the cookie options through to the write", () => {
		const store = new ConsentStore({
			initialState: null,
			cookieName: "my_consent",
			revision: 2,
		});

		store.acceptAll();

		expect(
			readConsentCookie(document.cookie, {
				cookieName: "my_consent",
				revision: 2,
			}),
		).toMatchObject({ status: "decided", revision: 2 });
		expect(readConsentCookie(document.cookie)).toEqual(undecidedConsent());
	});

	it("announces qb:consent on document for save and reset, not for hydrate", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		const mockListener = vi.fn();
		document.addEventListener(CONSENT_EVENT, mockListener);

		try {
			store.acceptAll();
			store.hydrate(decided());
			store.reset();
		} finally {
			document.removeEventListener(CONSENT_EVENT, mockListener);
		}

		expect(mockListener).toHaveBeenCalledTimes(2);
		const details = mockListener.mock.calls.map(
			([event]) => (event as CustomEvent<ConsentState>).detail,
		);
		expect(details[0]).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: true,
		});
		expect(details[0]).not.toHaveProperty("open");
		expect(details[1]).toEqual(undecidedConsent());
	});

	it("hydrate adopts a state for this revision without persisting", () => {
		const store = new ConsentStore({ initialState: null });

		store.hydrate(decided({ analytics: false, marketing: true }));

		expect(store.getState()).toEqual(
			decided({ analytics: false, marketing: true }),
		);
		expect(storedCookieNames()).toEqual([]);
	});

	it("hydrate reads a state for another revision as undecided", () => {
		const store = new ConsentStore({ initialState: null, revision: 2 });

		store.hydrate(decided({ revision: 1 }));

		expect(store.getState()).toEqual(undecidedConsent(2));
	});

	it("hydrate(null) returns to undecided", () => {
		const store = new ConsentStore({ initialState: decided() });

		store.hydrate(null);

		expect(store.getState()).toEqual(undecidedConsent());
	});

	it("hydrate keeps the panel flag as it was", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		store.openSettings();

		store.hydrate(decided());

		expect(store.getSnapshot().open).toBe(true);
	});

	it("reload picks up a cookie written by hand", () => {
		const store = new ConsentStore({ initialState: null });
		expect(store.getState().status).toBe("undecided");

		writeConsentCookie(decided({ analytics: true, marketing: true }));
		store.reload();

		expect(store.getState()).toEqual(
			decided({ analytics: true, marketing: true }),
		);
	});

	it("reload reads the configured cookie name and revision", () => {
		const store = new ConsentStore({
			initialState: null,
			cookieName: "my_consent",
			revision: 2,
		});

		writeConsentCookie(decided({ revision: 2 }), { cookieName: "my_consent" });
		store.reload();

		expect(store.getState().status).toBe("decided");
	});

	it("getState carries the decision only, without the UI flag", () => {
		const store = new ConsentStore({ persist: false, initialState: null });
		store.openSettings();

		const actual = store.getState();

		expect(actual).not.toHaveProperty("open");
		expect(Object.keys(actual).sort()).toEqual(
			["analytics", "decidedAt", "marketing", "revision", "status"].sort(),
		);
	});
});

describe("consentModeSignals", () => {
	const DENIED = {
		analytics_storage: "denied",
		ad_storage: "denied",
		ad_user_data: "denied",
		ad_personalization: "denied",
	};

	it("denies everything for null and undecided", () => {
		expect(consentModeSignals(null)).toEqual(DENIED);
		expect(consentModeSignals(undefined)).toEqual(DENIED);
		expect(consentModeSignals(undecidedConsent())).toEqual(DENIED);
	});

	it("grants analytics_storage alone for analytics only", () => {
		expect(
			consentModeSignals(decided({ analytics: true, marketing: false })),
		).toEqual({ ...DENIED, analytics_storage: "granted" });
	});

	it("grants the three ad signals for marketing only", () => {
		expect(
			consentModeSignals(decided({ analytics: false, marketing: true })),
		).toEqual({
			analytics_storage: "denied",
			ad_storage: "granted",
			ad_user_data: "granted",
			ad_personalization: "granted",
		});
	});

	it("grants everything for both", () => {
		expect(
			consentModeSignals(decided({ analytics: true, marketing: true })),
		).toEqual({
			analytics_storage: "granted",
			ad_storage: "granted",
			ad_user_data: "granted",
			ad_personalization: "granted",
		});
	});
});

describe("consentCategoriesParam", () => {
	it("is null for no state at all", () => {
		expect(consentCategoriesParam(null)).toBeNull();
		expect(consentCategoriesParam(undefined)).toBeNull();
	});

	it("is empty for undecided and for a decision granting nothing", () => {
		expect(consentCategoriesParam(undecidedConsent())).toBe("");
		expect(
			consentCategoriesParam(decided({ analytics: false, marketing: false })),
		).toBe("");
	});

	it("lists the granted categories", () => {
		expect(
			consentCategoriesParam(decided({ analytics: true, marketing: false })),
		).toBe("analytics");
		expect(
			consentCategoriesParam(decided({ analytics: false, marketing: true })),
		).toBe("marketing");
		expect(
			consentCategoriesParam(decided({ analytics: true, marketing: true })),
		).toBe("analytics,marketing");
	});
});

describe("consentLabels", () => {
	it("resolves Swedish from a bare code and from a BCP 47 tag", () => {
		expect(consentLabels("sv").title).toBe("Vi använder cookies");
		expect(consentLabels("sv-SE").title).toBe("Vi använder cookies");
		expect(consentLabels("SV_se").title).toBe("Vi använder cookies");
	});

	it("folds the Norwegian codes into bokmål", () => {
		expect(consentLabels("no").title).toBe("Vi bruker informasjonskapsler");
		expect(consentLabels("nn").title).toBe("Vi bruker informasjonskapsler");
		expect(consentLabels("nb-NO").title).toBe("Vi bruker informasjonskapsler");
	});

	it("has Danish and Finnish copy", () => {
		expect(consentLabels("da").title).toBe("Vi bruger cookies");
		expect(consentLabels("fi").title).toBe("Käytämme evästeitä");
	});

	it("falls back to English for an unknown language", () => {
		expect(consentLabels("xx").title).toBe("We use cookies");
		expect(consentLabels("de-DE").acceptAll).toBe("Accept all");
	});

	it("reads <html lang> when no language is given", () => {
		document.documentElement.lang = "sv";
		expect(consentLabels().title).toBe("Vi använder cookies");
		expect(consentLabels(null).title).toBe("Vi använder cookies");
		expect(consentLabels("   ").title).toBe("Vi använder cookies");
	});

	it("is English when neither an argument nor <html lang> says otherwise", () => {
		expect(consentLabels().title).toBe("We use cookies");
	});

	it("applies overrides on top of the language's defaults", () => {
		const actual = consentLabels("sv", { title: "Kakor!", save: "Klar" });

		expect(actual.title).toBe("Kakor!");
		expect(actual.save).toBe("Klar");
		expect(actual.acceptAll).toBe("Godkänn alla");
	});

	it("does not let an undefined override blank a default", () => {
		const actual = consentLabels("en", {
			title: undefined,
			acceptAll: "Yes please",
		});

		expect(actual.title).toBe("We use cookies");
		expect(actual.acceptAll).toBe("Yes please");
	});

	it("returns every label key for every language it has", () => {
		const expectedKeys = Object.keys(consentLabels("en")).sort();
		for (const lang of CONSENT_LABEL_LANGUAGES) {
			expect(Object.keys(consentLabels(lang)).sort()).toEqual(expectedKeys);
		}
		expect(CONSENT_LABEL_LANGUAGES).toEqual(
			expect.arrayContaining(["en", "sv", "da", "nb", "fi"]),
		);
	});

	it("treats a language that is only a prototype member as unknown", () => {
		// `<html lang="constructor">` must not resolve to Object.prototype's
		// function and render a banner with no copy.
		expect(resolveLanguage("constructor")).toBe("en");
		expect(resolveLanguage("__proto__")).toBe("en");
		expect(consentLabels("toString").title).toBe("We use cookies");
	});

	it("resolveLanguage exposes the same folding", () => {
		expect(resolveLanguage("sv-SE")).toBe("sv");
		expect(resolveLanguage("no")).toBe("nb");
		expect(resolveLanguage("xx")).toBe("en");
		expect(resolveLanguage(undefined)).toBe("en");
	});
});
