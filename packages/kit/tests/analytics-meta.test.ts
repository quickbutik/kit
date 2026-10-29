import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsContext } from "../src/analytics/destination.js";
import {
	metaPixelDestination,
	resetMetaPixels,
} from "../src/analytics/destinations/meta-pixel.js";
import type {
	CommerceEvent,
	CommerceItem,
	PurchaseEvent,
} from "../src/analytics/events.js";
import { resetInjectedScripts } from "../src/analytics/script.js";

type FbqFn = ((...args: unknown[]) => void) & {
	queue?: unknown[][];
	callMethod?: (...args: unknown[]) => void;
};

type MetaWindow = Window & { fbq?: FbqFn; _fbq?: FbqFn };

const w = (): MetaWindow => window as MetaWindow;

const CONTEXT: AnalyticsContext = { consent: null, storeId: "42" };

function queue(): unknown[][] {
	return w().fbq?.queue ?? [];
}

function metaScripts(): HTMLScriptElement[] {
	return Array.from(
		document.head.querySelectorAll<HTMLScriptElement>(
			'script[data-qb-analytics="meta"]',
		),
	);
}

/** A destination that has been loaded, so its calls land in the queue. */
function loaded(pixelId = "123") {
	const destination = metaPixelDestination({ pixelId });
	destination.load?.(CONTEXT);
	return destination;
}

/** What the queue received after the load's own consent, init and PageView. */
function sent(): unknown[][] {
	return queue().slice(3);
}

const TEE: CommerceItem = {
	item_id: "27",
	item_name: "Tee",
	price: 99,
	quantity: 1,
};
const CAP: CommerceItem = {
	item_id: "31",
	item_name: "Cap",
	price: 10,
	quantity: 2,
};

const PAGE_EVENT_ID = expect.stringMatching(/^pv_\d{10}$/);

beforeEach(() => {
	Reflect.deleteProperty(window, "fbq");
	Reflect.deleteProperty(window, "_fbq");
	for (const script of document.querySelectorAll(
		"script[data-qb-analytics], script[src*='connect.facebook.net']",
	)) {
		script.remove();
	}
	resetInjectedScripts();
	resetMetaPixels();
});

describe("metaPixelDestination — loading", () => {
	it("is hard-gated on marketing", () => {
		expect(metaPixelDestination({ pixelId: "123" }).requires).toBe("marketing");
	});

	it("does nothing before it is loaded — no stub, no script, no event", () => {
		const destination = metaPixelDestination({ pixelId: "123" });

		destination.track({ name: "view_item", params: { items: [TEE] } }, CONTEXT);
		destination.trackPurchase?.(
			{ transaction_id: "1", value: 1, currency: "SEK", items: [TEE] },
			{ eventId: "purchase_42_1" },
			CONTEXT,
		);

		expect(w().fbq).toBeUndefined();
		expect(metaScripts()).toHaveLength(0);
	});

	it("installs the fbq stub, injects fbevents.js, inits the pixel and sends PageView", () => {
		loaded();

		const fbq = w().fbq;
		expect(typeof fbq).toBe("function");
		expect(Array.isArray(fbq?.queue)).toBe(true);
		expect(w()._fbq).toBe(fbq);
		const scripts = metaScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.src).toBe(
			"https://connect.facebook.net/en_US/fbevents.js",
		);
		// Meta's consent API first: the pixel only loads on `marketing`.
		expect(queue()).toEqual([
			["consent", "grant"],
			["init", "123"],
			["track", "PageView", {}, { eventID: PAGE_EVENT_ID }],
		]);
	});

	it("loads once per destination", () => {
		const destination = loaded();

		destination.load?.(CONTEXT);

		expect(queue()).toHaveLength(3);
		expect(metaScripts()).toHaveLength(1);
	});

	it("never inits the same pixel twice, nor sends a second PageView, from a second destination", () => {
		// Two hubs on one page (two <qb-shop analytics> for the same shop, or
		// a hub rebuilt on an attribute change) are one page view, not two.
		const second = loaded();
		loaded();

		expect(queue().filter((call) => call[0] === "init")).toHaveLength(1);
		expect(queue().filter((call) => call[1] === "PageView")).toHaveLength(1);
		expect(metaScripts()).toHaveLength(1);

		// The second destination still delivers its own events.
		second.track({ name: "view_item", params: { items: [TEE] } }, CONTEXT);
		expect(queue().filter((call) => call[1] === "ViewContent")).toHaveLength(1);
	});

	it("inits a second, different pixel on the same page", () => {
		loaded("123");
		loaded("456");

		expect(queue().filter((call) => call[0] === "init")).toEqual([
			["init", "123"],
			["init", "456"],
		]);
	});

	it("reuses an fbq the page already has", () => {
		const mockFbq = vi.fn() as unknown as FbqFn;
		w().fbq = mockFbq;

		const destination = loaded();
		destination.track(
			{ name: "search", params: { search_term: "tee" } },
			CONTEXT,
		);

		expect(w().fbq).toBe(mockFbq);
		expect(mockFbq).toHaveBeenCalledWith("init", "123");
		expect(mockFbq).toHaveBeenCalledWith(
			"track",
			"Search",
			{ search_string: "tee", content_type: "product" },
			{ eventID: PAGE_EVENT_ID },
		);
	});

	it("hands calls to the real script once it has installed callMethod", () => {
		const destination = loaded();
		const mockCallMethod = vi.fn();
		const fbq = w().fbq as FbqFn;
		fbq.callMethod = mockCallMethod;

		destination.track(
			{ name: "search", params: { search_term: "tee" } },
			CONTEXT,
		);

		expect(mockCallMethod).toHaveBeenCalledWith(
			"track",
			"Search",
			{ search_string: "tee", content_type: "product" },
			{ eventID: PAGE_EVENT_ID },
		);
		expect(queue()).toHaveLength(3);
	});

	it("does nothing for a blank pixel id", () => {
		const destination = metaPixelDestination({ pixelId: "   " });

		destination.load?.(CONTEXT);

		expect(w().fbq).toBeUndefined();
		expect(metaScripts()).toHaveLength(0);
	});
});

describe("metaPixelDestination — event mapping", () => {
	it("maps view_item to ViewContent", () => {
		const destination = loaded();

		destination.track(
			{
				name: "view_item",
				params: { currency: "SEK", value: 99, items: [TEE] },
			},
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"track",
				"ViewContent",
				{
					content_type: "product",
					content_ids: ["27"],
					content_name: "Tee",
					value: 99,
					currency: "SEK",
				},
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps search to Search with the term and at most five ids", () => {
		const destination = loaded();
		const items = Array.from({ length: 7 }, (_, i) => ({
			item_id: String(i + 1),
		}));

		destination.track(
			{ name: "search", params: { search_term: "tee", items } },
			CONTEXT,
		);
		destination.track({ name: "search", params: {} }, CONTEXT);

		expect(sent()).toEqual([
			[
				"track",
				"Search",
				{
					search_string: "tee",
					content_type: "product",
					content_ids: ["1", "2", "3", "4", "5"],
				},
				{ eventID: PAGE_EVENT_ID },
			],
			[
				"track",
				"Search",
				{ search_string: "", content_type: "product" },
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps add_to_cart to AddToCart with Meta's basket, counting units", () => {
		const destination = loaded();

		destination.track(
			{
				name: "add_to_cart",
				params: { currency: "SEK", value: 119, items: [TEE, CAP] },
			},
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"track",
				"AddToCart",
				{
					content_type: "product",
					content_ids: ["27", "31"],
					contents: [
						{ id: "27", quantity: 1, item_price: 99 },
						{ id: "31", quantity: 2, item_price: 10 },
					],
					num_items: 3,
					content_name: "Tee",
					value: 119,
					currency: "SEK",
				},
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps begin_checkout to InitiateCheckout", () => {
		const destination = loaded();

		destination.track(
			{
				name: "begin_checkout",
				params: { currency: "SEK", value: 99, items: [TEE] },
			},
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"track",
				"InitiateCheckout",
				{
					content_type: "product",
					content_ids: ["27"],
					contents: [{ id: "27", quantity: 1, item_price: 99 }],
					num_items: 1,
					value: 99,
					currency: "SEK",
				},
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps add_payment_info to AddPaymentInfo with the money alone", () => {
		const destination = loaded();

		destination.track(
			{ name: "add_payment_info", params: { currency: "SEK", value: 99 } },
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"track",
				"AddPaymentInfo",
				{ value: 99, currency: "SEK" },
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps view_item_list to the custom ViewCategory with at most ten ids", () => {
		const destination = loaded();
		const items = Array.from({ length: 12 }, (_, i) => ({
			item_id: String(i + 1),
		}));

		destination.track(
			{
				name: "view_item_list",
				params: { item_list_name: "Tees", items },
			},
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"trackCustom",
				"ViewCategory",
				{
					content_type: "product",
					content_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
					content_name: "Tees",
				},
				{ eventID: PAGE_EVENT_ID },
			],
		]);
	});

	it("maps page_view to PageView", () => {
		const destination = loaded();

		destination.track({ name: "page_view", params: {} }, CONTEXT);

		expect(sent()).toEqual([
			["track", "PageView", {}, { eventID: PAGE_EVENT_ID }],
		]);
	});

	it("drops the events Meta has no name for", () => {
		const destination = loaded();

		for (const name of [
			"remove_from_cart",
			"add_shipping_info",
			"view_cart",
			"select_item",
			"something_custom",
		]) {
			destination.track({ name, params: { items: [TEE] } }, CONTEXT);
		}

		expect(sent()).toEqual([]);
	});

	it("maps a forwarded purchase event to Purchase, keyed on the order", () => {
		// The embedded checkout's inline confirmation reaches the host as a
		// plain `purchase` event (the frame has no pixel), so `track` must send
		// it too — under the same eventID `trackPurchase` would use.
		const destination = loaded();

		destination.track(
			{
				name: "purchase",
				params: {
					transaction_id: "1042",
					value: 99,
					currency: "SEK",
					items: [TEE],
				},
			},
			{ ...CONTEXT, storeId: "42" },
		);
		destination.track(
			{ name: "purchase", params: { value: 1, currency: "SEK", items: [] } },
			CONTEXT,
		);

		const actualSent = sent();
		expect(actualSent).toHaveLength(1);
		expect(actualSent[0]?.[1]).toBe("Purchase");
		expect(actualSent[0]?.[2]).toMatchObject({
			value: 99,
			currency: "SEK",
			content_ids: ["27"],
		});
		expect(actualSent[0]?.[3]).toEqual({ eventID: "purchase_42_1042" });
	});

	it("sends a forwarded purchase without an eventID when no store id is known", () => {
		// `purchase_{orderNumber}` could never merge with the platform's
		// `purchase_{storeId}_{orderNumber}`, and Meta only falls back to its
		// fbp / external_id match when an event carries no id at all. None is
		// strictly better than a wrong one.
		const destination = loaded();

		destination.track(
			{
				name: "purchase",
				params: {
					transaction_id: "1042",
					value: 99,
					currency: "SEK",
					items: [TEE],
				},
			},
			{ ...CONTEXT, storeId: null },
		);

		const actualSent = sent();
		expect(actualSent).toHaveLength(1);
		expect(actualSent[0]).toEqual([
			"track",
			"Purchase",
			expect.objectContaining({ value: 99, content_ids: ["27"] }),
		]);
	});

	it("uses one page event id for every non-purchase event", () => {
		const destination = loaded();

		destination.track({ name: "page_view", params: {} }, CONTEXT);
		destination.track({ name: "view_item", params: { items: [TEE] } }, CONTEXT);

		const ids = queue()
			.filter((call) => call[0] !== "init" && call[0] !== "consent")
			.map((call) => (call[3] as { eventID: string }).eventID);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(1);
	});

	it("does not share the page event id between two destinations", () => {
		loaded("123");
		loaded("456");

		const ids = queue()
			.filter((call) => call[1] === "PageView")
			.map((call) => (call[3] as { eventID: string }).eventID);
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it("dedupes content_ids across two variants of one product, keeping both lines", () => {
		const destination = loaded();

		destination.track(
			{
				name: "add_to_cart",
				params: {
					items: [
						{ ...TEE, item_variant: "Red / L" },
						{ ...TEE, item_variant: "Red / XL" },
					],
				},
			},
			CONTEXT,
		);

		const [, , params] = sent()[0] as [string, string, Record<string, unknown>];
		expect(params.content_ids).toEqual(["27"]);
		expect(params.contents).toHaveLength(2);
		expect(params.num_items).toBe(2);
	});

	it("leaves out item_price for an unpriced item and defaults its quantity to one", () => {
		const destination = loaded();

		destination.track(
			{ name: "begin_checkout", params: { items: [{ item_id: "5" }] } },
			CONTEXT,
		);

		const [, , params] = sent()[0] as [string, string, Record<string, unknown>];
		expect(params.contents).toEqual([{ id: "5", quantity: 1 }]);
		expect(params).not.toHaveProperty("value");
		expect(params).not.toHaveProperty("currency");
	});
});

describe("metaPixelDestination — purchases", () => {
	const PURCHASE: PurchaseEvent = {
		transaction_id: "1001",
		value: 129,
		currency: "SEK",
		tax: 25.8,
		shipping: 30,
		items: [TEE, CAP],
	};

	it("sends Purchase with the platform's eventID so the server-side event merges", () => {
		const destination = loaded();

		destination.trackPurchase?.(
			PURCHASE,
			{ eventId: "purchase_42_1001" },
			CONTEXT,
		);

		expect(sent()).toEqual([
			[
				"track",
				"Purchase",
				{
					content_type: "product",
					content_ids: ["27", "31"],
					contents: [
						{ id: "27", quantity: 1, item_price: 99 },
						{ id: "31", quantity: 2, item_price: 10 },
					],
					num_items: 3,
					value: 129,
					currency: "SEK",
				},
				{ eventID: "purchase_42_1001" },
			],
		]);
	});

	it("does not treat a purchase event through track() as a Purchase", () => {
		// The hub routes purchases to trackPurchase; a generic `purchase` event
		// has no mapping and must not fire a second, id-less Purchase.
		const destination = loaded();

		destination.track(
			{
				name: "purchase",
				params: { value: 129, items: [TEE] },
			} as CommerceEvent,
			CONTEXT,
		);

		expect(sent()).toEqual([]);
	});
});

describe("a merchant's own Partytown copy of the pixel", () => {
	it("is reused, not loaded a second time, and the page's Partytown config is left alone", () => {
		const forward = ["fbq"];
		(window as unknown as { partytown?: unknown }).partytown = { forward };
		const own = document.createElement("script");
		own.type = "text/partytown";
		own.src = "https://connect.facebook.net/en_US/fbevents.js";
		document.head.append(own);

		loaded();

		expect(
			document.querySelectorAll(
				'script[src="https://connect.facebook.net/en_US/fbevents.js"]',
			),
		).toHaveLength(1);
		expect(
			(window as unknown as { partytown: { forward: unknown } }).partytown
				.forward,
		).toBe(forward);
		expect(forward).toEqual(["fbq"]);
		own.remove();
		Reflect.deleteProperty(window, "partytown");
	});
});
