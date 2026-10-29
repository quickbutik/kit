import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../src/analytics/analytics.js";
import type { AnalyticsContext } from "../src/analytics/destination.js";
import {
	type CommerceEvent,
	type CommerceItem,
	type PurchaseEvent,
	purchaseDedupKey,
	purchaseEventId,
} from "../src/analytics/events.js";
import { ConsentStore } from "../src/consent/store.js";
import type { ConsentCategory } from "../src/consent/types.js";
import { CartStore } from "../src/state/cart-store.js";
import { makeClient } from "./elements/helpers.js";
import { cartEnvelope, cartLine, createFakeFetch } from "./helpers.js";

function spyDestination(
	id: string,
	requires: ConsentCategory | null,
	options: { purchase?: boolean } = {},
) {
	return {
		id,
		requires,
		load: vi.fn(),
		onConsent: vi.fn(),
		track: vi.fn(),
		...(options.purchase ? { trackPurchase: vi.fn() } : {}),
	};
}

function consentStore(): ConsentStore {
	return new ConsentStore({ persist: false, initialState: null });
}

/** A bare event with nothing the hub would fill in. */
function event(name: string, step?: number): CommerceEvent {
	return { name, params: step === undefined ? {} : { step } };
}

function trackedNames(destination: ReturnType<typeof spyDestination>) {
	return destination.track.mock.calls.map(
		([tracked]) => (tracked as CommerceEvent).name,
	);
}

const TEE: CommerceItem = {
	item_id: "27",
	item_name: "Tee",
	price: 99,
	quantity: 1,
};

const PURCHASE: PurchaseEvent = {
	transaction_id: "1001",
	value: 129,
	currency: "SEK",
	tax: 25.8,
	shipping: 30,
	items: [TEE],
};

beforeEach(() => {
	try {
		localStorage.clear();
	} catch {
		// No localStorage in this environment; nothing to clear.
	}
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Analytics — consent gating", () => {
	it("loads an ungated destination on start and delivers to it at once", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("ungated", null);
		const hub = new Analytics({ destinations: [mockDestination], consent });

		hub.track(event("before_start"));
		expect(mockDestination.load).not.toHaveBeenCalled();

		hub.start();
		hub.track(event("after_start"));

		expect(mockDestination.load).toHaveBeenCalledTimes(1);
		expect(mockDestination.load).toHaveBeenCalledWith({
			consent: consent.getState(),
			storeId: null,
			currency: undefined,
		});
		expect(trackedNames(mockDestination)).toEqual([
			"before_start",
			"after_start",
		]);
		expect(mockDestination.track.mock.calls[1]?.[1]).toEqual({
			consent: consent.getState(),
			storeId: null,
			currency: undefined,
		});
	});

	it("holds events for a gated destination until consent, then replays them in order", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();

		hub.track(event("one"));
		hub.track(event("two"));
		expect(mockDestination.load).not.toHaveBeenCalled();
		expect(mockDestination.track).not.toHaveBeenCalled();

		consent.acceptAll();

		expect(mockDestination.load).toHaveBeenCalledTimes(1);
		expect(trackedNames(mockDestination)).toEqual(["one", "two"]);
		const loadOrder = mockDestination.load.mock.invocationCallOrder[0] ?? 0;
		const firstTrackOrder =
			mockDestination.track.mock.invocationCallOrder[0] ?? 0;
		expect(loadOrder).toBeLessThan(firstTrackOrder);
	});

	it("drops the held events on a denial, and never replays them on a later grant", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();
		hub.track(event("before_denial"));

		consent.rejectAll();
		expect(mockDestination.track).not.toHaveBeenCalled();
		expect(mockDestination.load).not.toHaveBeenCalled();

		consent.acceptAll();
		hub.track(event("after_grant"));

		expect(trackedNames(mockDestination)).toEqual(["after_grant"]);
	});

	it("never delivers what happened under a stored denial, even after a later grant", () => {
		// The shopper said no on an earlier visit: the page loads already decided.
		const consent = new ConsentStore({
			persist: false,
			initialState: {
				status: "decided",
				analytics: false,
				marketing: false,
				decidedAt: "2026-10-01T10:00:00.000Z",
				revision: 1,
			},
		});
		const mockDestination = spyDestination("meta", "marketing");
		const mockLate = spyDestination("tiktok", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();
		hub.track(event("while_denied"));
		hub.addDestination(mockLate);

		consent.save({ analytics: false, marketing: true });
		hub.track(event("after_grant"));

		expect(trackedNames(mockDestination)).toEqual(["after_grant"]);
		expect(trackedNames(mockLate)).toEqual(["after_grant"]);
	});

	it("remembers only bufferSize events for a destination that is not ready", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({
			destinations: [mockDestination],
			consent,
			bufferSize: 3,
		});
		hub.start();
		for (let i = 1; i <= 5; i++) hub.track(event(`event_${i}`));

		consent.acceptAll();

		expect(trackedNames(mockDestination)).toEqual([
			"event_3",
			"event_4",
			"event_5",
		]);
	});

	it("still delivers to a ready destination with bufferSize: 0", () => {
		// Delivery reads from the same memory that buffers: an event is
		// remembered, then handed to every destination that may have it. A
		// buffer of zero would evict it in between, so the floor is one.
		const mockDestination = spyDestination("ungated", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			bufferSize: 0,
		});
		hub.start();

		hub.track(event("one"));
		hub.track(event("two"));

		expect(trackedNames(mockDestination)).toEqual(["one", "two"]);
	});

	it("gates at dispatch time, so a withdrawal stops new events immediately", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();
		consent.acceptAll();
		hub.track(event("allowed"));

		consent.rejectAll();
		hub.track(event("denied"));

		expect(trackedNames(mockDestination)).toEqual(["allowed"]);
	});

	it("tells loaded destinations about every real consent change, and only those", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();

		consent.openSettings();
		expect(mockDestination.onConsent).not.toHaveBeenCalled();

		consent.acceptAll();
		expect(mockDestination.onConsent).toHaveBeenCalledTimes(1);
		expect(mockDestination.onConsent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				status: "decided",
				analytics: true,
				marketing: true,
			}),
			expect.objectContaining({ storeId: null }),
		);

		// Same decision again: the signature is unchanged, so nobody is told.
		consent.acceptAll();
		expect(mockDestination.onConsent).toHaveBeenCalledTimes(1);

		consent.rejectAll();
		expect(mockDestination.onConsent).toHaveBeenCalledTimes(2);
		expect(mockDestination.onConsent).toHaveBeenLastCalledWith(
			expect.objectContaining({ analytics: false, marketing: false }),
			expect.anything(),
		);
	});

	it("tells a gated destination about the grant that loaded it, after loading it", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();
		hub.track(event("held"));

		consent.acceptAll();

		expect(mockDestination.onConsent).toHaveBeenCalledTimes(1);
		const loadOrder = mockDestination.load.mock.invocationCallOrder[0] ?? 0;
		const consentOrder =
			mockDestination.onConsent.mock.invocationCallOrder[0] ?? 0;
		expect(loadOrder).toBeLessThan(consentOrder);
	});

	it("does not notify a destination that was never loaded", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();

		consent.rejectAll();

		expect(mockDestination.onConsent).not.toHaveBeenCalled();
	});

	it("exposes the decision it gates on", () => {
		const consent = consentStore();
		const hub = new Analytics({ consent });

		expect(hub.requireConsent).toBe(true);
		expect(hub.consentState).toEqual(consent.getState());
		expect(hub.allows(null)).toBe(true);
		expect(hub.allows("necessary")).toBe(true);
		expect(hub.allows("analytics")).toBe(false);

		consent.save({ analytics: true, marketing: false });

		expect(hub.allows("analytics")).toBe(true);
		expect(hub.allows("marketing")).toBe(false);
	});
});

describe("Analytics — destinations", () => {
	it("replays the remembered events to a destination added later, and only to it", () => {
		const mockEarly = spyDestination("early", null);
		const hub = new Analytics({
			destinations: [mockEarly],
			requireConsent: false,
		});
		hub.start();
		hub.track(event("one"));
		hub.track(event("two"));

		const mockLate = spyDestination("late", null);
		hub.addDestination(mockLate);

		expect(trackedNames(mockLate)).toEqual(["one", "two"]);
		expect(mockLate.load).toHaveBeenCalledTimes(1);
		expect(trackedNames(mockEarly)).toEqual(["one", "two"]);
		expect(hub.destinations).toEqual([mockEarly, mockLate]);
	});

	it("ignores the same destination added twice", () => {
		const mockDestination = spyDestination("once", null);
		const hub = new Analytics({ requireConsent: false });
		hub.start();

		hub.addDestination(mockDestination);
		hub.addDestination(mockDestination);
		hub.track(event("one"));

		expect(hub.destinations).toHaveLength(1);
		expect(mockDestination.track).toHaveBeenCalledTimes(1);
	});

	it("does not deliver to a destination added before start until start", () => {
		const mockDestination = spyDestination("late", null);
		const hub = new Analytics({ requireConsent: false });
		hub.track(event("one"));

		hub.addDestination(mockDestination);
		expect(mockDestination.track).not.toHaveBeenCalled();

		hub.start();
		expect(trackedNames(mockDestination)).toEqual(["one"]);
	});

	it("runs ungated with requireConsent: false and no store, without warning", () => {
		const mockWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const mockDestination = spyDestination("meta", "marketing");
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});

		hub.start();
		hub.track(event("one"));

		expect(hub.consentState).toBeNull();
		expect(hub.allows("marketing")).toBe(true);
		expect(trackedNames(mockDestination)).toEqual(["one"]);
		expect(mockDestination.load).toHaveBeenCalledWith(
			expect.objectContaining({ consent: null }),
		);
		expect(mockWarn).not.toHaveBeenCalled();
	});

	it("warns once and sends nothing when consent is required but no store was given", () => {
		const mockWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const mockDestination = spyDestination("meta", "marketing");
		const mockUngated = spyDestination("google", null);
		const hub = new Analytics({ destinations: [mockDestination, mockUngated] });

		hub.start();
		hub.track(event("one"));
		hub.stop();
		hub.start();

		expect(mockWarn).toHaveBeenCalledTimes(1);
		expect(mockWarn.mock.calls[0]?.[0]).toMatch(/no consent store/);
		expect(mockDestination.track).not.toHaveBeenCalled();
		expect(mockDestination.load).not.toHaveBeenCalled();
		// An ungated destination needs no consent, so it still gets everything —
		// but as an undecided shopper, never as an ungated hub (`consent: null`
		// is what a destination reads as "everything granted").
		expect(trackedNames(mockUngated)).toEqual(["one"]);
		expect(mockUngated.load).toHaveBeenCalledWith(
			expect.objectContaining({
				consent: expect.objectContaining({ status: "undecided" }),
			}),
		);
		expect(hub.consentState?.status).toBe("undecided");
	});

	it("isolates a destination that throws from the others", () => {
		const mockError = vi.spyOn(console, "error").mockImplementation(() => {});
		const mockBroken = {
			...spyDestination("broken", null),
			track: vi.fn(() => {
				throw new Error("vendor exploded");
			}),
		};
		const mockHealthy = spyDestination("healthy", null);
		const hub = new Analytics({
			destinations: [mockBroken, mockHealthy],
			requireConsent: false,
		});
		hub.start();

		hub.track(event("one"));

		expect(trackedNames(mockHealthy)).toEqual(["one"]);
		expect(mockError).toHaveBeenCalledWith(
			expect.stringMatching(/"broken" threw on one/),
			expect.any(Error),
		);
	});

	it("isolates a destination whose load throws", () => {
		const mockError = vi.spyOn(console, "error").mockImplementation(() => {});
		const mockBroken = {
			...spyDestination("broken", null),
			load: vi.fn(() => {
				throw new Error("no script for you");
			}),
		};
		const mockHealthy = spyDestination("healthy", null);
		const hub = new Analytics({
			destinations: [mockBroken, mockHealthy],
			requireConsent: false,
		});

		hub.start();
		hub.track(event("one"));

		expect(mockError).toHaveBeenCalledWith(
			expect.stringMatching(/"broken" failed to load/),
			expect.any(Error),
		);
		expect(trackedNames(mockHealthy)).toEqual(["one"]);
		// Loading is attempted once; the events still flow to the broken one.
		expect(mockBroken.load).toHaveBeenCalledTimes(1);
		expect(trackedNames(mockBroken)).toEqual(["one"]);
	});

	it("logs every dispatch with debug: true", () => {
		const mockDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			debug: true,
		});
		hub.start();

		hub.track(event("one"));

		expect(mockDebug).toHaveBeenCalledWith(
			expect.stringContaining("google"),
			expect.objectContaining({ name: "one" }),
		);
	});
});

describe("Analytics — defaults on events", () => {
	it("fills the configured currency into an event with a value but no currency", () => {
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			currency: "NOK",
		});
		hub.start();

		hub.track({ name: "view_item", params: { value: 99, items: [TEE] } });
		hub.track({ name: "view_item", params: { currency: "EUR", value: 5 } });
		hub.track(event("search"));

		const params = mockDestination.track.mock.calls.map(
			([tracked]) => (tracked as CommerceEvent).params,
		);
		expect(params[0]?.currency).toBe("NOK");
		expect(params[1]?.currency).toBe("EUR");
		expect(params[2]).not.toHaveProperty("currency");
	});

	it("puts the store id and currency on the context", () => {
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			currency: "SEK",
			storeId: 42,
		});
		hub.start();

		hub.track(event("one"));

		expect(mockDestination.track.mock.calls[0]?.[1]).toEqual({
			consent: null,
			storeId: "42",
			currency: "SEK",
		} satisfies AnalyticsContext);
	});

	it("trackPageView is a page_view event", () => {
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();

		hub.trackPageView({ page_title: "Start" });

		expect(mockDestination.track).toHaveBeenCalledWith(
			{ name: "page_view", params: { page_title: "Start" } },
			expect.anything(),
		);
	});
});

describe("Analytics — purchases", () => {
	it("builds the platform's ids for an order", () => {
		expect(purchaseEventId(42, 1001)).toBe("purchase_42_1001");
		expect(purchaseDedupKey("42", "1001")).toBe("qb_purchase_tracked_42_1001");
	});

	it("hands the purchase to trackPurchase where there is one, else to track", () => {
		const mockWithPurchase = spyDestination("meta", null, { purchase: true });
		const mockPlain = spyDestination("plain", null);
		const hub = new Analytics({
			destinations: [mockWithPurchase, mockPlain],
			requireConsent: false,
			storeId: 42,
		});
		hub.start();

		const actual = hub.trackPurchase(PURCHASE, { orderNumber: 1001 });

		expect(actual).toBe(true);
		expect(mockWithPurchase.trackPurchase).toHaveBeenCalledWith(
			PURCHASE,
			{ eventId: "purchase_42_1001" },
			expect.objectContaining({ storeId: "42" }),
		);
		expect(mockWithPurchase.track).not.toHaveBeenCalled();
		expect(mockPlain.track).toHaveBeenCalledWith(
			{
				name: "purchase",
				params: {
					transaction_id: "1001",
					currency: "SEK",
					value: 129,
					tax: 25.8,
					shipping: 30,
					items: [TEE],
				},
			},
			expect.anything(),
		);
	});

	it("reports an order once per browser, through the platform's localStorage key", () => {
		const mockDestination = spyDestination("meta", null, { purchase: true });
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			storeId: 42,
		});
		hub.start();

		expect(hub.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(true);
		expect(hub.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(false);

		expect(mockDestination.trackPurchase).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem("qb_purchase_tracked_42_1001")).not.toBeNull();

		// A reloaded thank-you page is a fresh hub with the same storage.
		const mockReloaded = spyDestination("meta", null, { purchase: true });
		const reloaded = new Analytics({
			destinations: [mockReloaded],
			requireConsent: false,
			storeId: 42,
		});
		reloaded.start();
		expect(reloaded.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(false);
		expect(mockReloaded.trackPurchase).not.toHaveBeenCalled();
	});

	it("still deduplicates in memory when localStorage is unusable", () => {
		const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
		const throwing = () => {
			throw new Error("blocked");
		};
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: { getItem: throwing, setItem: throwing, removeItem: throwing },
		});
		try {
			const mockDestination = spyDestination("meta", null, { purchase: true });
			const hub = new Analytics({
				destinations: [mockDestination],
				requireConsent: false,
				storeId: 42,
			});
			hub.start();

			expect(hub.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(true);
			expect(hub.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(false);
			expect(mockDestination.trackPurchase).toHaveBeenCalledTimes(1);
		} finally {
			if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
		}
	});

	it("keys the order by the explicit store id, the hub's, or a placeholder", () => {
		const mockDestination = spyDestination("meta", null, { purchase: true });
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			storeId: 42,
		});
		hub.start();

		hub.trackPurchase(PURCHASE, { storeId: 7, orderNumber: 1001 });
		hub.trackPurchase({ ...PURCHASE, transaction_id: "1002" }, {});

		const eventIds = mockDestination.trackPurchase?.mock.calls.map(
			([, meta]) => (meta as { eventId: string }).eventId,
		);
		expect(eventIds).toEqual(["purchase_7_1001", "purchase_42_1002"]);

		const bare = new Analytics({
			destinations: [spyDestination("meta", null, { purchase: true })],
			requireConsent: false,
		});
		bare.start();
		bare.trackPurchase({ ...PURCHASE, transaction_id: "1003" }, {});
		expect(
			localStorage.getItem("qb_purchase_tracked_shop_1003"),
		).not.toBeNull();
	});

	it("holds a purchase for a gated destination like any other event", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("meta", "marketing", {
			purchase: true,
		});
		const hub = new Analytics({
			destinations: [mockDestination],
			consent,
			storeId: 42,
		});
		hub.start();

		expect(hub.trackPurchase(PURCHASE, { orderNumber: 1001 })).toBe(true);
		expect(mockDestination.trackPurchase).not.toHaveBeenCalled();

		consent.acceptAll();

		expect(mockDestination.trackPurchase).toHaveBeenCalledWith(
			PURCHASE,
			{ eventId: "purchase_42_1001" },
			expect.anything(),
		);
	});
});

describe("Analytics — the cart", () => {
	function cartRoutes() {
		return createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [cartLine()], itemCount: 1 }),
			},
			{ match: "DELETE /v2/cart/cart-1/items/line-1", body: cartEnvelope() },
		]);
	}

	it("turns cart mutations into add_to_cart and remove_from_cart", async () => {
		const fake = cartRoutes();
		const cartStore = new CartStore(makeClient(fake.fetch));
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(cartStore);

		await cartStore.add({ productId: "prod_27", variantId: 10 });
		await cartStore.removeItem("line-1");

		expect(mockDestination.track).toHaveBeenCalledTimes(2);
		expect(mockDestination.track.mock.calls[0]?.[0]).toEqual({
			name: "add_to_cart",
			params: {
				currency: "SEK",
				value: 99,
				items: [{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 }],
			},
		});
		expect(mockDestination.track.mock.calls[1]?.[0]).toEqual({
			name: "remove_from_cart",
			params: {
				currency: "SEK",
				value: 99,
				items: [{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 }],
			},
		});
	});

	it("learns the shop's currency from the cart for later events", async () => {
		const fake = cartRoutes();
		const cartStore = new CartStore(makeClient(fake.fetch));
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(cartStore);
		await cartStore.add({ productId: "prod_27", variantId: 10 });

		hub.track({ name: "view_item", params: { value: 99, items: [TEE] } });

		const last = mockDestination.track.mock.calls.at(-1)?.[0] as CommerceEvent;
		expect(last.params.currency).toBe("SEK");
		expect(mockDestination.track.mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ currency: "SEK" }),
		);
	});

	it("learns the shop's store id from the cart, for the context and the purchase key", async () => {
		// Neither <AnalyticsProvider> nor configure({ analytics: true }) is told
		// the store id; every cart names it, so the hub takes it from there. It
		// is what a forwarded inline purchase needs for a Meta eventID the
		// platform's server-side Purchase can merge with.
		const fake = cartRoutes();
		const cartStore = new CartStore(makeClient(fake.fetch));
		const mockDestination = spyDestination("meta", null, { purchase: true });
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(cartStore);
		hub.track(event("before"));
		expect(mockDestination.track.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({ storeId: null }),
		);

		await cartStore.add({ productId: "prod_27", variantId: 10 });
		hub.track(event("after"));
		hub.trackPurchase(PURCHASE, { orderNumber: 1001 });

		expect(mockDestination.track.mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ storeId: "42" }),
		);
		expect(mockDestination.trackPurchase).toHaveBeenCalledWith(
			PURCHASE,
			{ eventId: "purchase_42_1001" },
			expect.objectContaining({ storeId: "42" }),
		);
		expect(localStorage.getItem("qb_purchase_tracked_42_1001")).not.toBeNull();
	});

	it("prefers an explicit storeId over the cart's", () => {
		const loaded = cartEnvelope({ storeId: 7 }).data;
		const cartStore = new CartStore(
			makeClient(createFakeFetch([]).fetch),
			loaded as never,
		);
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
			storeId: 42,
		});
		hub.start();
		hub.attachCart(cartStore);

		hub.track(event("one"));

		expect(mockDestination.track.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({ storeId: "42" }),
		);
	});

	it("keeps the store id once seen, after the cart has gone away", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [cartLine()], itemCount: 1 }),
			},
			{
				match: "DELETE /v2/cart/cart-1",
				body: { message: "ok", statusCode: 200 },
			},
		]);
		const cartStore = new CartStore(makeClient(fake.fetch));
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(cartStore);
		await cartStore.add({ productId: "prod_27", variantId: 10 });
		await cartStore.clear();
		expect(cartStore.getSnapshot().cart).toBeNull();

		hub.track(event("after"));

		expect(mockDestination.track.mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ storeId: "42" }),
		);
	});

	it("takes the currency off a cart that is already loaded", () => {
		const loaded = cartEnvelope({ currency: "DKK" }).data;
		const cartStore = new CartStore(
			makeClient(createFakeFetch([]).fetch),
			loaded as never,
		);
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(cartStore);

		hub.track({ name: "view_item", params: { value: 5 } });

		expect(
			(mockDestination.track.mock.calls[0]?.[0] as CommerceEvent).params
				.currency,
		).toBe("DKK");
	});

	it("stops when detached", async () => {
		const fake = cartRoutes();
		const cartStore = new CartStore(makeClient(fake.fetch));
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		const detach = hub.attachCart(cartStore);

		detach();
		await cartStore.add({ productId: "prod_27", variantId: 10 });

		expect(mockDestination.track).not.toHaveBeenCalled();
	});

	it("attaching a second cart detaches the first", async () => {
		const fake = cartRoutes();
		const first = new CartStore(makeClient(fake.fetch));
		const second = new CartStore(makeClient(createFakeFetch([]).fetch));
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.attachCart(first);
		hub.attachCart(second);

		await first.add({ productId: "prod_27", variantId: 10 });

		expect(mockDestination.track).not.toHaveBeenCalled();
	});
});

describe("Analytics — lifecycle", () => {
	it("holds events while stopped and delivers them on the next start", () => {
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({
			destinations: [mockDestination],
			requireConsent: false,
		});
		hub.start();
		hub.track(event("one"));

		hub.stop();
		hub.track(event("two"));
		expect(trackedNames(mockDestination)).toEqual(["one"]);

		hub.start();
		expect(trackedNames(mockDestination)).toEqual(["one", "two"]);
	});

	it("stops listening to consent while stopped", () => {
		const consent = consentStore();
		const mockDestination = spyDestination("google", null);
		const hub = new Analytics({ destinations: [mockDestination], consent });
		hub.start();
		hub.stop();

		consent.acceptAll();

		expect(mockDestination.onConsent).not.toHaveBeenCalled();
	});

	it("destroy forgets the remembered events and the cart", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [cartLine()], itemCount: 1 }),
			},
		]);
		const cartStore = new CartStore(makeClient(fake.fetch));
		const hub = new Analytics({ requireConsent: false });
		hub.start();
		hub.attachCart(cartStore);
		hub.track(event("one"));

		hub.destroy();

		const mockLate = spyDestination("late", null);
		hub.addDestination(mockLate);
		hub.start();
		await cartStore.add({ productId: "prod_27", variantId: 10 });

		expect(mockLate.track).not.toHaveBeenCalled();
	});

	it("start and stop are idempotent", () => {
		const consent = consentStore();
		const mockSubscribe = vi.spyOn(consent, "subscribe");
		const hub = new Analytics({ consent });

		hub.start();
		hub.start();
		hub.stop();
		hub.stop();

		expect(mockSubscribe).toHaveBeenCalledTimes(1);
	});
});
