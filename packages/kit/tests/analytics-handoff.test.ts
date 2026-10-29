import { beforeEach, describe, expect, it } from "vitest";
import {
	appendCheckoutHandoffParams,
	readGaCookies,
} from "../src/analytics/handoff.js";
import { undecidedConsent } from "../src/consent/cookie.js";
import type { ConsentState } from "../src/consent/types.js";

const GA_COOKIES = "_ga=GA1.1.123.456; _ga_ABC=GS1.1.1700000000.1.0.0";

const CHECKOUT_URL = "https://checkout.test/checkout/42/sess-1";

function decided(analytics: boolean, marketing: boolean): ConsentState {
	return {
		status: "decided",
		analytics,
		marketing,
		decidedAt: "2026-10-01T10:00:00.000Z",
		revision: 1,
	};
}

function params(url: string): URLSearchParams {
	return new URL(url).searchParams;
}

function clearCookies(): void {
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

beforeEach(() => {
	clearCookies();
});

describe("readGaCookies", () => {
	it("extracts the client id and the session id", () => {
		expect(readGaCookies(GA_COOKIES)).toEqual({
			clientId: "123.456",
			sessionId: "1700000000",
		});
	});

	it("reads the newer GS2 session cookie with its s prefix", () => {
		expect(
			readGaCookies(
				"_ga_ABC=GS2.1.s1700000001$o1$g0$t1700000100$j60$l0$h0; _ga=GA1.1.9.8",
			),
		).toEqual({ clientId: "9.8", sessionId: "1700000001" });
	});

	it("is all nulls without the cookies", () => {
		expect(readGaCookies("")).toEqual({ clientId: null, sessionId: null });
		expect(readGaCookies(null)).toEqual({ clientId: null, sessionId: null });
		expect(readGaCookies("qb_cart_id=cart-1")).toEqual({
			clientId: null,
			sessionId: null,
		});
	});

	it("ignores cookies that do not match Google's format", () => {
		expect(readGaCookies("_ga=garbage; _ga_ABC=nope")).toEqual({
			clientId: null,
			sessionId: null,
		});
	});

	it("takes the first property cookie that parses", () => {
		expect(
			readGaCookies("_ga_ONE=broken; _ga_TWO=GS1.1.1700000002.1.0.0"),
		).toEqual({ clientId: null, sessionId: "1700000002" });
	});

	it("reads document.cookie when given nothing", () => {
		// biome-ignore lint/suspicious/noDocumentCookie: the subject under test reads the raw jar.
		document.cookie = "_ga=GA1.1.9.8; path=/";
		// biome-ignore lint/suspicious/noDocumentCookie: see above.
		document.cookie = "_ga_X=GS1.1.1700000002.1.0.0; path=/";

		expect(readGaCookies()).toEqual({
			clientId: "9.8",
			sessionId: "1700000002",
		});
	});
});

describe("appendCheckoutHandoffParams", () => {
	it("reports an undecided shopper as an empty consentCategories and links no GA ids", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, undecidedConsent(), {
				cookies: GA_COOKIES,
			}),
		);

		expect(actual.has("consentCategories")).toBe(true);
		expect(actual.get("consentCategories")).toBe("");
		expect(actual.has("gaClientId")).toBe(false);
		expect(actual.has("gaSessionId")).toBe(false);
	});

	it("treats a missing state as undecided when consent is required", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, null, { cookies: GA_COOKIES }),
		);

		expect(actual.get("consentCategories")).toBe("");
		expect(actual.has("gaClientId")).toBe(false);
	});

	it("sends analytics and the GA session link for analytics only", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(true, false), {
				cookies: GA_COOKIES,
			}),
		);

		expect(actual.get("consentCategories")).toBe("analytics");
		expect(actual.get("gaClientId")).toBe("123.456");
		expect(actual.get("gaSessionId")).toBe("1700000000");
	});

	it("sends marketing without any GA ids for marketing only", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(false, true), {
				cookies: GA_COOKIES,
			}),
		);

		expect(actual.get("consentCategories")).toBe("marketing");
		expect(actual.has("gaClientId")).toBe(false);
		expect(actual.has("gaSessionId")).toBe(false);
	});

	it("sends both categories and the GA ids for a full grant", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(true, true), {
				cookies: GA_COOKIES,
			}),
		);

		expect(actual.get("consentCategories")).toBe("analytics,marketing");
		expect(actual.get("gaClientId")).toBe("123.456");
		expect(actual.get("gaSessionId")).toBe("1700000000");
	});

	it("sends an empty consentCategories for a decision granting nothing", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(false, false), {
				cookies: GA_COOKIES,
			}),
		);

		expect(actual.get("consentCategories")).toBe("");
		expect(actual.has("gaClientId")).toBe(false);
	});

	it("omits consentCategories entirely, and links GA, when consent is not required", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, undecidedConsent(), {
				cookies: GA_COOKIES,
				requireConsent: false,
			}),
		);

		expect(actual.has("consentCategories")).toBe(false);
		expect(actual.get("gaClientId")).toBe("123.456");
		expect(actual.get("gaSessionId")).toBe("1700000000");
	});

	it("leaves the GA cookies alone with linkGa: false", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(true, true), {
				cookies: GA_COOKIES,
				linkGa: false,
			}),
		);

		expect(actual.get("consentCategories")).toBe("analytics,marketing");
		expect(actual.has("gaClientId")).toBe(false);
		expect(actual.has("gaSessionId")).toBe(false);
	});

	it("adds only the GA ids the cookies actually carry", () => {
		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(true, true), {
				cookies: "_ga=GA1.1.123.456",
			}),
		);

		expect(actual.get("gaClientId")).toBe("123.456");
		expect(actual.has("gaSessionId")).toBe(false);
	});

	it("keeps the query the URL already has", () => {
		const actual = appendCheckoutHandoffParams(
			`${CHECKOUT_URL}?lang=sv`,
			decided(true, false),
			{ cookies: GA_COOKIES },
		);

		const url = new URL(actual);
		expect(url.origin + url.pathname).toBe(CHECKOUT_URL);
		expect(url.searchParams.get("lang")).toBe("sv");
		expect(url.searchParams.get("consentCategories")).toBe("analytics");
	});

	it("overwrites a consentCategories the URL already carries", () => {
		const actual = params(
			appendCheckoutHandoffParams(
				`${CHECKOUT_URL}?consentCategories=analytics,marketing`,
				decided(false, false),
				{ cookies: "" },
			),
		);

		expect(actual.getAll("consentCategories")).toEqual([""]);
	});

	it("returns a URL it cannot parse unchanged", () => {
		expect(
			appendCheckoutHandoffParams("/checkout/42/sess-1", decided(true, true)),
		).toBe("/checkout/42/sess-1");
		expect(appendCheckoutHandoffParams("", decided(true, true))).toBe("");
	});

	it("reads the GA cookies from document.cookie by default", () => {
		// biome-ignore lint/suspicious/noDocumentCookie: the subject under test reads the raw jar.
		document.cookie = "_ga=GA1.1.9.8; path=/";

		const actual = params(
			appendCheckoutHandoffParams(CHECKOUT_URL, decided(true, false)),
		);

		expect(actual.get("gaClientId")).toBe("9.8");
	});
});
