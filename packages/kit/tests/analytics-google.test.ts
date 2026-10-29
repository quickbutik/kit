import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsContext } from "../src/analytics/destination.js";
import {
	CONSENT_UPDATE_EVENT,
	googleTagDestination,
	resetGoogleTags,
} from "../src/analytics/destinations/google-tag.js";
import type { CommerceEvent, PurchaseEvent } from "../src/analytics/events.js";
import { resetInjectedScripts } from "../src/analytics/script.js";
import { undecidedConsent } from "../src/consent/cookie.js";
import type { ConsentState } from "../src/consent/types.js";

type GoogleWindow = Window & {
	dataLayer?: unknown[];
	gtag?: (...args: unknown[]) => void;
};

const w = (): GoogleWindow => window as GoogleWindow;

function isArguments(value: unknown): value is ArrayLike<unknown> {
	return Object.prototype.toString.call(value) === "[object Arguments]";
}

/** The dataLayer with every gtag `arguments` object turned into a plain array. */
function layer(): unknown[] {
	return (w().dataLayer ?? []).map((entry) =>
		isArguments(entry) ? Array.from(entry) : entry,
	);
}

/** The gtag commands of one kind on the dataLayer (`config`, `event`, ...). */
function commands(kind: string): unknown[][] {
	return layer().filter(
		(entry): entry is unknown[] => Array.isArray(entry) && entry[0] === kind,
	);
}

function context(consent: ConsentState | null): AnalyticsContext {
	return { consent, storeId: null };
}

function googleScripts(): HTMLScriptElement[] {
	return Array.from(
		document.head.querySelectorAll<HTMLScriptElement>(
			'script[data-qb-analytics="google"]',
		),
	);
}

const DENIED = {
	analytics_storage: "denied",
	ad_storage: "denied",
	ad_user_data: "denied",
	ad_personalization: "denied",
};

const GRANTED = {
	analytics_storage: "granted",
	ad_storage: "granted",
	ad_user_data: "granted",
	ad_personalization: "granted",
};

const DECIDED: ConsentState = {
	status: "decided",
	analytics: true,
	marketing: false,
	decidedAt: "2026-10-01T10:00:00.000Z",
	revision: 1,
};

const VIEW_ITEM: CommerceEvent = {
	name: "view_item",
	params: {
		currency: "SEK",
		value: 99,
		items: [{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 }],
	},
};

const PURCHASE: PurchaseEvent = {
	transaction_id: "1001",
	value: 129,
	currency: "SEK",
	tax: 25.8,
	shipping: 30,
	items: [{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 }],
};

beforeEach(() => {
	Reflect.deleteProperty(window, "dataLayer");
	Reflect.deleteProperty(window, "gtag");
	for (const script of document.querySelectorAll(
		"script[data-qb-analytics], script[src*='googletagmanager.com']",
	)) {
		script.remove();
	}
	resetInjectedScripts();
	resetGoogleTags();
});

describe("googleTagDestination — gtag.js", () => {
	it("waits for analytics consent by default, and loads before it only when asked", () => {
		expect(googleTagDestination({ ga4MeasurementId: "G-1" }).requires).toBe(
			"analytics",
		);
		expect(
			googleTagDestination({
				ga4MeasurementId: "G-1",
				loadBeforeConsent: true,
			}).requires,
		).toBeNull();
	});

	it("sets a denied consent default, then js and config, before injecting gtag.js", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(undecidedConsent()));

		expect(layer()).toEqual([
			["consent", "default", { ...DENIED, wait_for_update: 500 }],
			["js", expect.any(Date)],
			["config", "G-1", { send_page_view: true }],
		]);
		const scripts = googleScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.src).toBe(
			"https://www.googletagmanager.com/gtag/js?id=G-1",
		);
		expect(scripts[0]?.async).toBe(true);
	});

	it("loads once, however often it is asked", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(undecidedConsent()));
		destination.load?.(context(undecidedConsent()));

		expect(layer()).toHaveLength(3);
		expect(googleScripts()).toHaveLength(1);
	});

	it("configures a measurement id once per page, even from a second destination", () => {
		// Two hubs for the same shop on one page (two <qb-shop analytics>, a hub
		// rebuilt on an attribute change): a second `config` would record a
		// second automatic page_view. The second destination still sends.
		const first = googleTagDestination({ ga4MeasurementId: "G-1" });
		const second = googleTagDestination({ ga4MeasurementId: "G-1" });

		first.load?.(context(undecidedConsent()));
		second.load?.(context(undecidedConsent()));
		second.track(VIEW_ITEM, context(undecidedConsent()));

		expect(commands("config")).toEqual([
			["config", "G-1", { send_page_view: true }],
		]);
		expect(layer().at(-1)).toEqual(["event", "view_item", VIEW_ITEM.params]);
		expect(googleScripts()).toHaveLength(1);
	});

	it("configures a different measurement id on the same page", () => {
		googleTagDestination({ ga4MeasurementId: "G-1" }).load?.(context(null));
		googleTagDestination({ ga4MeasurementId: "G-2" }).load?.(context(null));

		expect(commands("config").map((entry) => entry[1])).toEqual(["G-1", "G-2"]);
	});

	it("follows the default with an update when the shopper has already decided", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(DECIDED));

		expect(layer().slice(0, 2)).toEqual([
			["consent", "default", { ...DENIED, wait_for_update: 500 }],
			["consent", "update", { ...DENIED, analytics_storage: "granted" }],
		]);
	});

	it("updates to everything granted when the hub runs ungated", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(null));

		expect(layer()[1]).toEqual(["consent", "update", GRANTED]);
	});

	it("pushes a consent update and a GTM trigger event on every consent change", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });
		destination.load?.(context(undecidedConsent()));
		const before = layer().length;

		destination.onConsent?.(DECIDED, context(DECIDED));

		expect(layer().slice(before)).toEqual([
			["consent", "update", { ...DENIED, analytics_storage: "granted" }],
			{
				event: CONSENT_UPDATE_EVENT,
				qb_consent: { status: "decided", analytics: true, marketing: false },
			},
		]);
		expect(CONSENT_UPDATE_EVENT).toBe("qb_consent_update");
	});

	it("reports an ungated hub as everything granted on consent change", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });
		destination.load?.(context(null));
		const before = layer().length;

		destination.onConsent?.(null, context(null));

		expect(layer().slice(before)).toEqual([
			["consent", "update", GRANTED],
			{
				event: CONSENT_UPDATE_EVENT,
				qb_consent: { status: "none", analytics: true, marketing: true },
			},
		]);
	});

	it("does nothing before it is loaded", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.track(VIEW_ITEM, context(null));
		destination.onConsent?.(DECIDED, context(DECIDED));

		expect(w().dataLayer).toBeUndefined();
		expect(googleScripts()).toHaveLength(0);
	});

	it("forwards events through gtag('event', …)", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });
		destination.load?.(context(null));

		destination.track(VIEW_ITEM, context(null));

		expect(layer().at(-1)).toEqual(["event", "view_item", VIEW_ITEM.params]);
	});

	it("forwards a purchase as a purchase event", () => {
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });
		destination.load?.(context(null));

		destination.trackPurchase?.(
			PURCHASE,
			{ eventId: "purchase_42_1001" },
			context(null),
		);

		expect(layer().at(-1)).toEqual([
			"event",
			"purchase",
			{
				transaction_id: "1001",
				currency: "SEK",
				value: 129,
				tax: 25.8,
				shipping: 30,
				items: PURCHASE.items,
			},
		]);
	});

	it("can leave the automatic page_view to the storefront", () => {
		const destination = googleTagDestination({
			ga4MeasurementId: "G-1",
			sendPageView: false,
		});

		destination.load?.(context(null));

		expect(layer()).toContainEqual([
			"config",
			"G-1",
			{ send_page_view: false },
		]);
	});

	it("stitches an existing GA session through the config", () => {
		const destination = googleTagDestination({
			ga4MeasurementId: "G-1",
			gaLink: { clientId: "123.456", sessionId: "1700000000" },
		});

		destination.load?.(context(null));

		expect(layer()).toContainEqual([
			"config",
			"G-1",
			{ send_page_view: true, client_id: "123.456", session_id: "1700000000" },
		]);
	});

	it("configures Google Ads on the same tag", () => {
		const destination = googleTagDestination({
			ga4MeasurementId: "G-1",
			adsConversionId: "AW-9",
		});

		destination.load?.(context(null));

		const actual = layer();
		expect(actual).toContainEqual(["config", "G-1", { send_page_view: true }]);
		expect(actual).toContainEqual([
			"config",
			"AW-9",
			{ allow_enhanced_conversions: true },
		]);
		expect(googleScripts()[0]?.src).toContain("gtag/js?id=G-1");
	});

	it("loads gtag.js for an Ads id alone", () => {
		const destination = googleTagDestination({ adsConversionId: "AW-9" });

		destination.load?.(context(null));
		destination.track(VIEW_ITEM, context(null));

		expect(googleScripts()[0]?.src).toBe(
			"https://www.googletagmanager.com/gtag/js?id=AW-9",
		);
		expect(layer().at(-1)).toEqual(["event", "view_item", VIEW_ITEM.params]);
	});

	it("can be hard-gated on analytics instead", () => {
		expect(
			googleTagDestination({
				ga4MeasurementId: "G-1",
				loadBeforeConsent: false,
			}).requires,
		).toBe("analytics");
	});

	it("reuses a gtag the page already has", () => {
		const mockGtag = vi.fn();
		w().gtag = mockGtag;
		w().dataLayer = [];
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(null));
		destination.track(VIEW_ITEM, context(null));

		expect(w().gtag).toBe(mockGtag);
		expect(mockGtag).toHaveBeenCalledWith("consent", "default", {
			...DENIED,
			wait_for_update: 500,
		});
		expect(mockGtag).toHaveBeenCalledWith(
			"event",
			"view_item",
			VIEW_ITEM.params,
		);
		// The page's gtag owns the dataLayer; the kit pushed nothing itself.
		expect(w().dataLayer).toEqual([]);
	});

	it("keeps a gtag.js tag the page already carries instead of adding a second", () => {
		const existing = document.createElement("script");
		existing.src = "https://www.googletagmanager.com/gtag/js?id=G-1";
		document.head.appendChild(existing);
		const destination = googleTagDestination({ ga4MeasurementId: "G-1" });

		destination.load?.(context(null));

		expect(
			document.querySelectorAll(
				'script[src="https://www.googletagmanager.com/gtag/js?id=G-1"]',
			),
		).toHaveLength(1);
		expect(googleScripts()).toHaveLength(0);
		expect(layer()).toHaveLength(4);
	});

	it("does nothing at all without an id", () => {
		for (const destination of [
			googleTagDestination({}),
			googleTagDestination({ ga4MeasurementId: "   ", gtmContainerId: null }),
		]) {
			destination.load?.(context(null));
			destination.track(VIEW_ITEM, context(null));
		}

		expect(w().dataLayer).toBeUndefined();
		expect(googleScripts()).toHaveLength(0);
	});
});

describe("googleTagDestination — Google Tag Manager", () => {
	it("bootstraps the container after the consent default", () => {
		const destination = googleTagDestination({ gtmContainerId: "GTM-1" });

		destination.load?.(context(undecidedConsent()));

		expect(layer()).toEqual([
			["consent", "default", { ...DENIED, wait_for_update: 500 }],
			{ "gtm.start": expect.any(Number), event: "gtm.js" },
		]);
		const scripts = googleScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.src).toBe(
			"https://www.googletagmanager.com/gtm.js?id=GTM-1",
		);
	});

	it("bootstraps a container once per page, even from a second destination", () => {
		const first = googleTagDestination({ gtmContainerId: "GTM-1" });
		const second = googleTagDestination({ gtmContainerId: "GTM-1" });

		first.load?.(context(undecidedConsent()));
		second.load?.(context(undecidedConsent()));

		expect(
			layer().filter(
				(entry) =>
					typeof entry === "object" &&
					entry !== null &&
					!Array.isArray(entry) &&
					(entry as { event?: string }).event === "gtm.js",
			),
		).toHaveLength(1);
		expect(googleScripts()).toHaveLength(1);
	});

	it("pushes events as ecommerce objects with the GA4 reset, and never through gtag", () => {
		const destination = googleTagDestination({ gtmContainerId: "GTM-1" });
		destination.load?.(context(null));
		const before = layer().length;

		destination.track(VIEW_ITEM, context(null));

		expect(layer().slice(before)).toEqual([
			{ ecommerce: null },
			{ event: "view_item", ecommerce: VIEW_ITEM.params },
		]);
		expect(
			layer().filter((entry) => Array.isArray(entry) && entry[0] === "event"),
		).toHaveLength(0);
	});

	it("sends events through gtag only when GA4 and GTM are both configured", () => {
		const destination = googleTagDestination({
			ga4MeasurementId: "G-1",
			gtmContainerId: "GTM-1",
		});
		destination.load?.(context(null));
		const before = layer().length;

		destination.track(VIEW_ITEM, context(null));

		expect(layer().slice(before)).toEqual([
			["event", "view_item", VIEW_ITEM.params],
		]);
		expect(googleScripts().map((script) => script.src)).toEqual([
			"https://www.googletagmanager.com/gtag/js?id=G-1",
			"https://www.googletagmanager.com/gtm.js?id=GTM-1",
		]);
	});

	it("gives a GTM-only page the consent update too", () => {
		const destination = googleTagDestination({ gtmContainerId: "GTM-1" });
		destination.load?.(context(undecidedConsent()));
		const before = layer().length;

		destination.onConsent?.(DECIDED, context(DECIDED));

		expect(layer().slice(before)[0]).toEqual([
			"consent",
			"update",
			{ ...DENIED, analytics_storage: "granted" },
		]);
	});
});

describe("googleTagDestination — consent first (the default)", () => {
	it("injects no GTM container for an undecided shopper, and default-then-update on a grant", async () => {
		const { Analytics } = await import("../src/analytics/analytics.js");
		const { ConsentStore } = await import("../src/consent/store.js");
		const consent = new ConsentStore({ initialState: null, persist: false });
		const hub = new Analytics({
			consent,
			destinations: [googleTagDestination({ gtmContainerId: "GTM-TEST" })],
		});
		hub.start();

		expect(googleScripts()).toHaveLength(0);
		expect(layer()).toEqual([]);

		consent.acceptAll();

		const entries = layer();
		expect(entries[0]).toEqual([
			"consent",
			"default",
			{ ...DENIED, wait_for_update: 500 },
		]);
		expect(entries[1]).toEqual(["consent", "update", GRANTED]);
		expect(entries[2]).toMatchObject({ event: "gtm.js" });
		expect(googleScripts().map((script) => script.src)).toEqual([
			"https://www.googletagmanager.com/gtm.js?id=GTM-TEST",
		]);
		hub.destroy();
	});
});

describe("a merchant's own Partytown copy of the tag", () => {
	it("is reused, not loaded a second time, and the page's Partytown config is left alone", async () => {
		const { Analytics } = await import("../src/analytics/analytics.js");
		const { ConsentStore } = await import("../src/consent/store.js");
		const forward = ["dataLayer.push"];
		(window as unknown as { partytown?: unknown }).partytown = { forward };
		const own = document.createElement("script");
		own.type = "text/partytown";
		own.src = "https://www.googletagmanager.com/gtm.js?id=GTM-X";
		document.head.append(own);
		const consent = new ConsentStore({ initialState: null, persist: false });
		const hub = new Analytics({
			consent,
			destinations: [googleTagDestination({ gtmContainerId: "GTM-X" })],
		});
		hub.start();
		consent.acceptAll();

		expect(
			document.querySelectorAll(
				'script[src="https://www.googletagmanager.com/gtm.js?id=GTM-X"]',
			),
		).toHaveLength(1);
		expect(
			(window as unknown as { partytown: { forward: unknown } }).partytown
				.forward,
		).toBe(forward);
		expect(forward).toEqual(["dataLayer.push"]);
		hub.destroy();
		own.remove();
		Reflect.deleteProperty(window, "partytown");
	});
});
