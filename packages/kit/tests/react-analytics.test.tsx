import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import type { Analytics } from "../src/analytics/analytics.js";
import type { AnalyticsDestination } from "../src/analytics/destination.js";
import { resetGoogleTags } from "../src/analytics/destinations/google-tag.js";
import {
	metaPixelDestination,
	resetMetaPixels,
} from "../src/analytics/destinations/meta-pixel.js";
import type { CommerceEvent } from "../src/analytics/events.js";
import { resetInjectedScripts } from "../src/analytics/script.js";
import { ConsentStore } from "../src/consent/store.js";
import type { ConsentState } from "../src/consent/types.js";
import {
	AnalyticsProvider,
	useAnalytics,
	useOptionalAnalytics,
	useTrackPurchase,
} from "../src/react/analytics.js";
import { Checkout } from "../src/react/checkout.js";
import { ConsentProvider } from "../src/react/consent.js";
import { ProductProvider } from "../src/react/product-context.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { useCart } from "../src/react/use-cart.js";
import { useProductSearch } from "../src/react/use-catalog.js";
import {
	useCheckout,
	useOrderConfirmation,
} from "../src/react/use-checkout.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import { PRODUCT } from "./elements/helpers.js";
import { frameIn, sendFromFrame, stubFrameWindow } from "./embed-helpers.js";
import { embedFrameMessageFixtures } from "./fixtures/embed-messages.fixtures.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

const SHOP = {
	name: "Shop",
	brand: { logo: null, color: { primary: null } },
	tracking: {
		ga4MeasurementId: "G-TEST1",
		gtmContainerId: null,
		metaPixelId: "123456",
		metaCapiEnabled: false,
	},
};

const HANDOFF = {
	sessionId: "sess-1",
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	fields: {},
	data: {},
	checkout: "v2",
	hostedUrl: "https://checkout.test/checkout/42/sess-1",
	embedUrl: "https://checkout.test/embed/42/sess-1",
};

const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
	storeId: 42,
});

/** A completed session, as the thank-you page reads it back. */
const SESSION = {
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	fields: {},
	data: {
		cart_products: {
			value: [
				{
					productId: "27",
					variantId: "10",
					name: "Tee",
					variantName: "L",
					price: 9900,
					quantity: 2,
					imageUrl: null,
				},
			],
			resolvedAt: "2026-10-01T10:00:00.000Z",
		},
		order_total: {
			value: {
				subtotal: 19800,
				subtotalExclTax: 15840,
				subtotalInclTax: 19800,
				totalTax: 3960,
				totalDiscount: 0,
				totalShipping: 4900,
				totalPaymentFee: 0,
				total: 24700,
				currency: "SEK",
				lines: [],
			},
			resolvedAt: "2026-10-01T10:00:00.000Z",
		},
	},
	isComplete: true,
	blockingFields: [],
};

const EXPECTED_PURCHASE_PARAMS = {
	transaction_id: "777",
	currency: "SEK",
	value: 247,
	tax: 39.6,
	shipping: 49,
	items: [
		{
			item_id: "27",
			item_name: "Tee",
			item_variant: "L",
			price: 99,
			quantity: 2,
		},
	],
};

const DECIDED_ANALYTICS_ONLY: ConsentState = {
	status: "decided",
	analytics: true,
	marketing: false,
	decidedAt: "2026-10-01T10:00:00.000Z",
	revision: 1,
};

function makeClient(
	fetchImpl: typeof globalThis.fetch,
	storage = createMemoryStorage(),
) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fetchImpl,
		storage,
		maxRetries: 0,
	});
}

/** The cleanest way to see what the hub sends: a destination that only records. */
function spyDestination(
	requires: AnalyticsDestination["requires"] = null,
): AnalyticsDestination & { track: Mock<(event: CommerceEvent) => void> } {
	return { id: "spy", requires, track: vi.fn() };
}

function eventsNamed(
	spy: { track: Mock<(event: CommerceEvent) => void> },
	name: string,
): CommerceEvent[] {
	return spy.track.mock.calls
		.map((call) => call[0])
		.filter((event) => event.name === name);
}

/** The gtag commands on the dataLayer (the `arguments` objects), as arrays. */
function gtagCalls(): unknown[][] {
	const layer =
		(window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
	return layer
		.filter(
			(entry): entry is ArrayLike<unknown> =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as ArrayLike<unknown>).length === "number",
		)
		.map((entry) => Array.from(entry));
}

function clearCookies(): void {
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

/** An undecided store that writes no cookie, so suites do not bleed into each other. */
function undecidedStore(): ConsentStore {
	return new ConsentStore({ initialState: null, persist: false });
}

/**
 * The three providers, composed by hand. `consent={false}` on the shop
 * provider (deprecated, and it says so once) keeps it from mounting its own
 * store, banner and hub, so this suite exercises the standalone pieces.
 */
function Providers({
	store,
	client,
	destinations,
	auto = false,
	requireConsent,
	children,
}: {
	store: ConsentStore | null;
	client: ReturnType<typeof makeClient>;
	destinations?: AnalyticsDestination[];
	auto?: boolean;
	requireConsent?: boolean;
	children: ReactNode;
}) {
	const shop = (
		<ShopkitProvider client={client} consent={false}>
			<AnalyticsProvider
				auto={auto}
				destinations={destinations}
				requireConsent={requireConsent}
			>
				{children}
			</AnalyticsProvider>
		</ShopkitProvider>
	);
	return store ? <ConsentProvider store={store}>{shop}</ConsentProvider> : shop;
}

beforeEach(() => {
	clearCookies();
	localStorage.clear();
	const w = window as unknown as Record<string, unknown>;
	delete w.dataLayer;
	delete w.gtag;
	delete w.fbq;
	delete w._fbq;
	for (const script of document.head.querySelectorAll("[data-qb-analytics]")) {
		script.remove();
	}
	resetInjectedScripts();
	resetGoogleTags();
	resetMetaPixels();
	window.history.replaceState({}, "", "/");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("<AnalyticsProvider>", () => {
	it("loads the shop's tracking ids and gates the pixels on consent", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		const inputStore = undecidedStore();
		render(
			<Providers store={inputStore} client={makeClient(fake.fetch)} auto>
				<span />
			</Providers>,
		);

		// Nothing from Google or Meta before the decision.
		await waitFor(() =>
			expect(
				fake.calls.filter((call) => call.url.endsWith("/v2/checkout/shop")),
			).toHaveLength(1),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(
			document.head.querySelector('script[data-qb-analytics="google"]'),
		).toBeNull();
		expect(
			document.head.querySelector('script[data-qb-analytics="meta"]'),
		).toBeNull();
		expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
		expect(gtagCalls()).toEqual([]);

		act(() => inputStore.acceptAll());

		// Granted: the denied default first, the update straight after, then
		// js and config, all ahead of the script.
		const calls = gtagCalls();
		expect(calls[0]?.slice(0, 2)).toEqual(["consent", "default"]);
		expect(calls[0]?.[2]).toMatchObject({
			analytics_storage: "denied",
			ad_storage: "denied",
			ad_user_data: "denied",
			ad_personalization: "denied",
			wait_for_update: 500,
		});
		expect(calls[1]?.slice(0, 2)).toEqual(["consent", "update"]);
		const configIndex = calls.findIndex((call) => call[0] === "config");
		expect(configIndex).toBeGreaterThan(1);
		expect(calls[configIndex]?.[1]).toBe("G-TEST1");
		expect(
			document.head.querySelector('script[data-qb-analytics="google"]'),
		).toBeTruthy();
		const update = calls[1];
		expect(update?.[2]).toEqual({
			analytics_storage: "granted",
			ad_storage: "granted",
			ad_user_data: "granted",
			ad_personalization: "granted",
		});
		// Marketing granted: the pixel arrives now, and only now.
		expect(
			document.head.querySelector('script[data-qb-analytics="meta"]'),
		).toBeTruthy();
		expect((window as unknown as { fbq?: unknown }).fbq).toBeTypeOf("function");
	});

	it("adds the shop's destinations once per hub when auto is switched off and on again", async () => {
		// The hub survives the toggle (same client, same consent store), but
		// the effect re-runs and the shared shop promise resolves again with
		// fresh destination objects, which identity dedup does not catch.
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		const captured: { hub: Analytics | null } = { hub: null };
		function Capture() {
			captured.hub = useAnalytics();
			return null;
		}
		const ids = () => captured.hub?.destinations.map((d) => d.id);
		const client = makeClient(fake.fetch);
		const store = undecidedStore();
		const tree = (auto: boolean) => (
			<Providers store={store} client={client} auto={auto}>
				<Capture />
			</Providers>
		);

		const { rerender } = render(tree(true));
		await waitFor(() => expect(ids()).toEqual(["google", "meta"]));
		const first = captured.hub;
		rerender(tree(false));
		rerender(tree(true));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(captured.hub).toBe(first);
		expect(ids()).toEqual(["google", "meta"]);
		expect(fake.calls).toHaveLength(1);
	});

	it("keeps Meta off the page when only analytics is granted", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		const inputStore = new ConsentStore({
			initialState: DECIDED_ANALYTICS_ONLY,
			persist: false,
		});
		render(
			<Providers store={inputStore} client={makeClient(fake.fetch)} auto>
				<span />
			</Providers>,
		);

		await waitFor(() =>
			expect(
				document.head.querySelector('script[data-qb-analytics="google"]'),
			).toBeTruthy(),
		);
		// Decided before load: the denied default is followed by an update
		// straight away, before the property is configured.
		const calls = gtagCalls();
		expect(calls[0]?.slice(0, 2)).toEqual(["consent", "default"]);
		expect(calls[1]?.slice(0, 2)).toEqual(["consent", "update"]);
		expect(calls[1]?.[2]).toMatchObject({
			analytics_storage: "granted",
			ad_storage: "denied",
		});
		expect(
			document.head.querySelector('script[data-qb-analytics="meta"]'),
		).toBeNull();
	});

	it("warns once when the shop has nothing configured", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/shop",
				body: {
					...SHOP,
					tracking: {
						ga4MeasurementId: null,
						gtmContainerId: null,
						metaPixelId: null,
						metaCapiEnabled: false,
					},
				},
			},
		]);
		render(
			<StrictMode>
				<Providers
					store={undecidedStore()}
					client={makeClient(fake.fetch)}
					auto
				>
					<span />
				</Providers>
			</StrictMode>,
		);

		await waitFor(() =>
			expect(warn).toHaveBeenCalledWith(
				expect.stringMatching(/no GA4, GTM or Meta pixel configured/),
			),
		);
		expect(
			warn.mock.calls.filter((call) =>
				/no GA4, GTM or Meta pixel/.test(String(call[0])),
			),
		).toHaveLength(1);
		// One request, StrictMode double effect or not.
		expect(fake.calls).toHaveLength(1);
		expect(document.head.querySelector("[data-qb-analytics]")).toBeNull();
	});

	it("fails closed without a <ConsentProvider>: warns, sends nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const spy = spyDestination("analytics");
		render(
			<Providers
				store={null}
				client={makeClient(createFakeFetch([]).fetch)}
				destinations={[spy]}
			>
				<ProductProvider product={PRODUCT} currency="SEK">
					<span>product</span>
				</ProductProvider>
			</Providers>,
		);

		await waitFor(() =>
			expect(warn).toHaveBeenCalledWith(
				expect.stringMatching(/no consent store/),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(spy.track).not.toHaveBeenCalled();
	});

	it("loads nothing from Google without a <ConsentProvider>", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		render(
			<Providers store={null} client={makeClient(fake.fetch)} auto>
				<span />
			</Providers>,
		);

		await waitFor(() => expect(fake.calls).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 10));
		// A missing store is an undecided shopper, not an ungated hub: nothing
		// from Google or Meta is loaded, and no Consent Mode command is sent.
		expect(document.head.querySelector("script[data-qb-analytics]")).toBeNull();
		expect(gtagCalls()).toEqual([]);
	});

	it("loads Google before a decision, under the denied default, only with loadBeforeConsent", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		render(
			<ConsentProvider store={undecidedStore()}>
				<ShopkitProvider client={makeClient(fake.fetch)} consent={false}>
					<AnalyticsProvider loadBeforeConsent>
						<span />
					</AnalyticsProvider>
				</ShopkitProvider>
			</ConsentProvider>,
		);
		await waitFor(() =>
			expect(
				document.head.querySelector('script[data-qb-analytics="google"]'),
			).toBeTruthy(),
		);
		const calls = gtagCalls();
		expect(calls[0]?.slice(0, 2)).toEqual(["consent", "default"]);
		expect(
			calls.some((call) => call[0] === "consent" && call[1] === "update"),
		).toBe(false);
		expect(
			document.head.querySelector('script[data-qb-analytics="meta"]'),
		).toBeNull();
	});

	it("runs ungated with requireConsent: false", async () => {
		const spy = spyDestination("marketing");
		render(
			<Providers
				store={null}
				client={makeClient(createFakeFetch([]).fetch)}
				destinations={[spy]}
				requireConsent={false}
			>
				<ProductProvider product={PRODUCT} currency="SEK">
					<span>product</span>
				</ProductProvider>
			</Providers>,
		);

		await waitFor(() => expect(eventsNamed(spy, "view_item")).toHaveLength(1));
	});

	it("useAnalytics throws without a provider; useOptionalAnalytics is null", () => {
		function Orphan() {
			useAnalytics();
			return null;
		}
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => render(<Orphan />)).toThrow(ShopkitConfigError);

		let actual: unknown = "unset";
		function Probe() {
			actual = useOptionalAnalytics();
			return null;
		}
		render(<Probe />);
		expect(actual).toBeNull();
	});
});

describe("auto-tracked events", () => {
	it("reports view_item once per product, StrictMode double effect included", async () => {
		const spy = spyDestination();
		const client = makeClient(createFakeFetch([]).fetch);
		const tree = (product: typeof PRODUCT) => (
			<StrictMode>
				<Providers
					store={undecidedStore()}
					client={client}
					destinations={[spy]}
				>
					<ProductProvider product={product} currency="SEK">
						<span>product</span>
					</ProductProvider>
				</Providers>
			</StrictMode>
		);
		const { rerender } = render(tree(PRODUCT));

		await waitFor(() => expect(eventsNamed(spy, "view_item")).toHaveLength(1));
		expect(eventsNamed(spy, "view_item")[0]).toEqual({
			name: "view_item",
			params: {
				currency: "SEK",
				value: 99,
				items: [
					{
						item_id: "27",
						item_name: "Complex Product",
						price: 99,
						quantity: 1,
					},
				],
			},
		});

		// The same product as a new object (a revalidation): not a second view.
		rerender(tree({ ...PRODUCT }));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(eventsNamed(spy, "view_item")).toHaveLength(1);

		// A different product in the same slot is.
		rerender(tree({ ...PRODUCT, id: "prod_28", name: "Other" }));
		await waitFor(() => expect(eventsNamed(spy, "view_item")).toHaveLength(2));
		expect(eventsNamed(spy, "view_item")[1]?.params.items).toEqual([
			{ item_id: "28", item_name: "Other", price: 99, quantity: 1 },
		]);
	});

	it("reports search once per settled term", async () => {
		const body = {
			data: [{ id: "prod_1", name: "Merino Crew" }],
			has_more: false,
			next_cursor: null,
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body },
			{ match: "GET /v2/products/search", body },
		]);
		const spy = spyDestination();
		const client = makeClient(fake.fetch);
		function Grid({ term }: { term: string }) {
			// A NEW params object every render, as callers write it.
			const { data } = useProductSearch({ search: term, limit: 24 });
			return <span>{data?.data[0]?.name ?? "-"}</span>;
		}
		const tree = (term: string) => (
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<Grid term={term} />
			</Providers>
		);
		const { rerender } = render(tree("merino"));

		await waitFor(() => expect(screen.getByText("Merino Crew")).toBeTruthy());
		await waitFor(() => expect(eventsNamed(spy, "search")).toHaveLength(1));
		expect(eventsNamed(spy, "search")[0]?.params).toEqual({
			search_term: "merino",
		});

		rerender(tree("merino"));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(eventsNamed(spy, "search")).toHaveLength(1);

		rerender(tree("wool"));
		await waitFor(() => expect(eventsNamed(spy, "search")).toHaveLength(2));
		expect(eventsNamed(spy, "search")[1]?.params).toEqual({
			search_term: "wool",
		});
		expect(fake.calls).toHaveLength(2);
	});

	it("reports add_to_cart from useCart().add, with the quantity that changed", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ items: [cartLine()], itemCount: 1, total: 9900 }),
			},
		]);
		const spy = spyDestination();
		function Add() {
			const { add, status } = useCart();
			return (
				<button
					type="button"
					disabled={status !== "ready"}
					onClick={() => void add({ productId: 27, variantId: 10 })}
				>
					add
				</button>
			);
		}
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch)}
				destinations={[spy]}
			>
				<Add />
			</Providers>,
		);
		await waitFor(() =>
			expect((screen.getByText("add") as HTMLButtonElement).disabled).toBe(
				false,
			),
		);

		await act(async () => {
			screen.getByText("add").click();
		});

		await waitFor(() =>
			expect(eventsNamed(spy, "add_to_cart")).toHaveLength(1),
		);
		expect(eventsNamed(spy, "add_to_cart")[0]?.params).toEqual({
			currency: "SEK",
			value: 99,
			items: [{ item_id: "27", item_name: "Tee", price: 99, quantity: 1 }],
		});
	});

	it("reports add_to_cart in the currency the cart is priced in (charge mode)", async () => {
		const eurCart = (extra: Record<string, unknown>) =>
			cartEnvelope({
				currency: "EUR",
				presentment: {
					mode: "charge",
					chargeCurrency: "EUR",
					baseCurrency: "SEK",
					exchangeRate: 0.0871,
				},
				...extra,
			});
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: eurCart({}) },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: eurCart({
					items: [cartLine({ unitPrice: 862, unitPriceInclTax: 862 })],
					itemCount: 1,
					total: 862,
				}),
			},
		]);
		const spy = spyDestination();
		let add: ReturnType<typeof useCart>["add"] | null = null;
		function Add() {
			add = useCart().add;
			return null;
		}
		render(
			<Providers
				store={undecidedStore()}
				client={createShopkitClient({
					publishableKey: TEST_KEY,
					apiUrl: "https://gateway.test",
					fetch: fake.fetch,
					storage: createMemoryStorage(),
					maxRetries: 0,
					currency: "EUR",
				})}
				destinations={[spy]}
			>
				<Add />
			</Providers>,
		);
		await act(async () => {
			await add?.({ productId: 27, variantId: 10 });
		});
		await waitFor(() =>
			expect(eventsNamed(spy, "add_to_cart")).toHaveLength(1),
		);
		expect(eventsNamed(spy, "add_to_cart")[0]?.params).toMatchObject({
			currency: "EUR",
			value: 8.62,
		});
	});

	it("reports view_item in the product's own currency, over the provider's", async () => {
		const spy = spyDestination();
		render(
			<Providers
				store={
					new ConsentStore({
						initialState: DECIDED_ANALYTICS_ONLY,
						persist: false,
					})
				}
				client={makeClient(createFakeFetch([]).fetch)}
				destinations={[spy]}
			>
				<ProductProvider
					product={{ ...PRODUCT, price: 862, currency: "EUR" } as never}
					currency="SEK"
				>
					<span>product</span>
				</ProductProvider>
			</Providers>,
		);
		await waitFor(() => expect(eventsNamed(spy, "view_item")).toHaveLength(1));
		expect(eventsNamed(spy, "view_item")[0]?.params.currency).toBe("EUR");
	});

	it("reports the purchase in the currency the checkout charged (charge mode)", async () => {
		const eurSession = {
			...SESSION,
			data: {
				...SESSION.data,
				order_total: {
					...SESSION.data.order_total,
					value: { ...SESSION.data.order_total.value, currency: "EUR" },
				},
			},
		};
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: eurSession },
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_store_id", "42");
		const spy = spyDestination();
		function Settled() {
			useOrderConfirmation("sess-1", {
				initialConfirmation: { status: "completed", orderNumber: 778 } as never,
			});
			return null;
		}
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, storage)}
				destinations={[spy]}
			>
				<Settled />
			</Providers>,
		);
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		expect(eventsNamed(spy, "purchase")[0]?.params.currency).toBe("EUR");
	});

	it("forwards the embedded checkout's events, and still calls onEvent", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const spy = spyDestination();
		const onEvent = vi.fn();
		const { container } = render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, storage)}
				destinations={[spy]}
			>
				<Checkout successUrl="/thanks" onEvent={onEvent} />
			</Providers>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		const { frameWindow } = stubFrameWindow(frameIn(container));

		sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.event, { source: frameWindow });

		const expected = {
			name: embedFrameMessageFixtures.event.name,
			params: embedFrameMessageFixtures.event.params,
		};
		expect(onEvent).toHaveBeenCalledWith(expected);
		expect(eventsNamed(spy, "add_shipping_info")).toEqual([expected]);
	});

	it("gives a forwarded inline purchase the platform's Meta eventID, with the store id learned from the cart", async () => {
		// Nobody tells <AnalyticsProvider> the store id; the cart the checkout
		// was mounted from names it. The checkout's server-side CAPI Purchase
		// is `purchase_{shopId}_{orderNumber}`, so this is the only id Meta
		// can merge it with.
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const store = undecidedStore();
		store.acceptAll();
		const { container } = render(
			<Providers
				store={store}
				client={makeClient(fake.fetch, storage)}
				destinations={[metaPixelDestination({ pixelId: "123" })]}
			>
				<Checkout successUrl="/thanks" />
			</Providers>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		const { frameWindow } = stubFrameWindow(frameIn(container));

		sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
		sendFromFrame(
			{
				...embedFrameMessageFixtures.event,
				name: "purchase",
				params: {
					transaction_id: "1042",
					currency: "SEK",
					value: 99,
					items: [{ item_id: "27", item_name: "Tee", quantity: 1, price: 99 }],
				},
			},
			{ source: frameWindow },
		);

		const fbq = (window as unknown as { fbq?: { queue?: unknown[][] } }).fbq;
		const purchases = (fbq?.queue ?? []).filter(
			(call) => call[1] === "Purchase",
		);
		expect(purchases).toHaveLength(1);
		expect(purchases[0]?.[3]).toEqual({ eventID: "purchase_42_1042" });
	});
});

describe("useCheckout() handoff", () => {
	function handoffRoutes(): FakeRoute[] {
		return [
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		];
	}

	/** Renders a probe and starts a checkout from it; resolves the URL. */
	async function startFrom(tree: (probe: ReactNode) => ReactNode) {
		let checkout: ReturnType<typeof useCheckout> | null = null;
		function Probe() {
			checkout = useCheckout();
			return null;
		}
		render(tree(<Probe />));
		let url: string | null = null;
		await act(async () => {
			const result = await (
				checkout as unknown as ReturnType<typeof useCheckout>
			).start({ successUrl: "https://myshop.test/order" });
			url = result?.url ?? null;
		});
		if (!url) throw new Error("start() returned no URL");
		return new URL(url);
	}

	it("carries the granted categories, and the GA link, with consent alone", async () => {
		// biome-ignore lint/suspicious/noDocumentCookie: the GA cookie a real page would carry.
		document.cookie = "_ga=GA1.1.123456.789; path=/";
		const client = makeClient(createFakeFetch(handoffRoutes()).fetch);
		const actual = await startFrom((probe) => (
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ShopkitProvider client={client} consent={false}>
					{probe}
				</ShopkitProvider>
			</ConsentProvider>
		));

		expect(actual.origin + actual.pathname).toBe(
			"https://checkout.test/checkout/42/sess-1",
		);
		expect(actual.searchParams.get("consentCategories")).toBe("analytics");
		expect(actual.searchParams.get("gaClientId")).toBe("123456.789");
	});

	it("reports an undecided shopper as consentCategories= (present, empty)", async () => {
		const client = makeClient(createFakeFetch(handoffRoutes()).fetch);
		const actual = await startFrom((probe) => (
			<ConsentProvider store={undecidedStore()}>
				<ShopkitProvider client={client} consent={false}>
					{probe}
				</ShopkitProvider>
			</ConsentProvider>
		));

		expect(actual.searchParams.has("consentCategories")).toBe(true);
		expect(actual.searchParams.get("consentCategories")).toBe("");
		expect(actual.searchParams.has("gaClientId")).toBe(false);
	});

	it("leaves the URL alone when neither provider is rendered", async () => {
		const client = makeClient(createFakeFetch(handoffRoutes()).fetch);
		const actual = await startFrom((probe) => (
			<ShopkitProvider client={client} consent={false}>
				{probe}
			</ShopkitProvider>
		));

		expect(actual.toString()).toBe("https://checkout.test/checkout/42/sess-1");
	});

	it("sends consentCategories= for analytics without a consent provider, and nothing with requireConsent: false", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const gated = await startFrom((probe) => (
			<Providers
				store={null}
				client={makeClient(createFakeFetch(handoffRoutes()).fetch)}
			>
				{probe}
			</Providers>
		));
		expect(gated.searchParams.get("consentCategories")).toBe("");

		const ungated = await startFrom((probe) => (
			<Providers
				store={
					new ConsentStore({
						initialState: DECIDED_ANALYTICS_ONLY,
						persist: false,
					})
				}
				client={makeClient(createFakeFetch(handoffRoutes()).fetch)}
				requireConsent={false}
			>
				{probe}
			</Providers>
		));
		expect(ungated.searchParams.has("consentCategories")).toBe(false);
	});

	it("navigates redirectToCheckout and buyNow to the decorated URL", async () => {
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		const fake = createFakeFetch([
			...handoffRoutes(),
			// buyNow: add to the remembered cart, then hand off again.
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		]);
		let checkout: ReturnType<typeof useCheckout> | null = null;
		function Probe() {
			checkout = useCheckout();
			return null;
		}
		render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ShopkitProvider client={makeClient(fake.fetch)}>
					<Probe />
				</ShopkitProvider>
			</ConsentProvider>,
		);
		const hook = () => checkout as unknown as ReturnType<typeof useCheckout>;
		const input = { successUrl: "https://myshop.test/order" };

		await act(async () => {
			await hook().redirectToCheckout(input);
		});
		expect(assign).toHaveBeenCalledTimes(1);
		expect(
			new URL(assign.mock.calls[0]?.[0]).searchParams.get("consentCategories"),
		).toBe("analytics");

		// Released as a bfcache restore would release it.
		act(() => {
			window.dispatchEvent(
				Object.assign(new Event("pageshow"), { persisted: true }),
			);
		});
		await act(async () => {
			await hook().buyNow({ productId: "prod_27", variantId: 10 }, input);
		});
		expect(assign).toHaveBeenCalledTimes(2);
		expect(
			new URL(assign.mock.calls[1]?.[0]).searchParams.get("consentCategories"),
		).toBe("analytics");
		expect(hook().url).toContain("consentCategories=analytics");
		act(() => {
			window.dispatchEvent(
				Object.assign(new Event("pageshow"), { persisted: true }),
			);
		});
	});
});

describe("purchase tracking", () => {
	/** What a thank-you page arrives with: the cart's store id and the remembered session. */
	async function rememberedSession() {
		const storage = createMemoryStorage();
		await storage.set("qb_store_id", "42");
		await storage.set("qb_checkout_session", "sess-1");
		await storage.set("qb_checkout_store", "42");
		return storage;
	}

	function ThankYou({
		trackPurchase,
		sessionId,
	}: {
		trackPurchase?: boolean;
		sessionId?: string;
	}) {
		const { status, orderNumber, loading } = useOrderConfirmation(sessionId, {
			trackPurchase,
		});
		if (loading) return <span>polling</span>;
		return <span>{`${status}:${orderNumber}`}</span>;
	}

	it("useOrderConfirmation reports the purchase once, with the platform's dedup key", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const spy = spyDestination();
		render(
			<StrictMode>
				<Providers
					store={undecidedStore()}
					client={makeClient(fake.fetch, await rememberedSession())}
					destinations={[spy]}
				>
					<ThankYou />
				</Providers>
			</StrictMode>,
		);

		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		expect(eventsNamed(spy, "purchase")[0]?.params).toEqual(
			EXPECTED_PURCHASE_PARAMS,
		);
		// The store id was captured before the completed poll forgot it.
		expect(localStorage.getItem("qb_purchase_tracked_42_777")).toBeTruthy();
		expect(
			fake.calls.filter((call) =>
				call.url.endsWith("/checkout/sessions/sess-1"),
			),
		).toHaveLength(1);
	});

	it("reports the purchase from a server-settled confirmation, without polling", async () => {
		// The common case: the page took the snapshot on the server, it is
		// already `completed`, so the hook never polls. It still owns the
		// purchase, so the page needs no `useTrackPurchase` of its own.
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const spy = spyDestination();
		function SettledThankYou() {
			const { status, orderNumber, loading } = useOrderConfirmation("sess-1", {
				initialConfirmation: {
					status: "completed",
					orderNumber: 777,
				} as never,
			});
			return <span>{loading ? "polling" : `${status}:${orderNumber}`}</span>;
		}
		render(
			<StrictMode>
				<Providers
					store={undecidedStore()}
					client={makeClient(fake.fetch, await rememberedSession())}
					destinations={[spy]}
				>
					<SettledThankYou />
				</Providers>
			</StrictMode>,
		);

		// Final on the first render: no spinner, no confirmation request.
		expect(screen.getByText("completed:777")).toBeTruthy();
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		expect(eventsNamed(spy, "purchase")[0]?.params).toEqual(
			EXPECTED_PURCHASE_PARAMS,
		);
		expect(localStorage.getItem("qb_purchase_tracked_42_777")).toBeTruthy();
		expect(fake.calls.some((call) => call.url.endsWith("/confirmation"))).toBe(
			false,
		);
	});

	it("tracks the settled purchase even when forgetting the checkout fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const client = makeClient(fake.fetch, await rememberedSession());
		vi.spyOn(client.checkout, "finalize").mockRejectedValue(
			new Error("storage is read-only"),
		);
		vi.spyOn(client.checkout, "currentSessionId").mockRejectedValue(
			new Error("storage is read-only"),
		);
		const spy = spyDestination();
		function Settled() {
			useOrderConfirmation("sess-1", {
				initialConfirmation: { status: "completed", orderNumber: 777 } as never,
			});
			return null;
		}
		render(
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<Settled />
			</Providers>,
		);
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		expect(
			warn.mock.calls.some((call) =>
				String(call[0]).includes("could not forget"),
			),
		).toBe(true);
	});

	it("keys the settled purchase on the remembered store id even when reading the session fails first", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const storage = await rememberedSession();
		// Only the copy kept next to the checkout session, which `finalize()`
		// forgets: the store id has to be read before it runs.
		await storage.remove("qb_store_id");
		const client = makeClient(fake.fetch, storage);
		// The first read fails (a cookie jar hiccup); the purchase still has to
		// be keyed on the shop's store id, not the key's prefix.
		vi.spyOn(client.checkout, "currentSessionId")
			.mockRejectedValueOnce(new Error("storage hiccup"))
			.mockResolvedValue("sess-1");
		const spy = spyDestination();
		function Settled() {
			useOrderConfirmation(null, {
				initialConfirmation: { status: "completed", orderNumber: 777 } as never,
			});
			return null;
		}
		render(
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<Settled />
			</Providers>,
		);
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		expect(localStorage.getItem("qb_purchase_tracked_42_777")).toBeTruthy();
		expect(
			Object.keys(localStorage).filter((key) => key.includes("shop123")),
		).toEqual([]);
	});

	it("never double-fires when useTrackPurchase runs beside the settled path", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const spy = spyDestination();
		function BothOwners() {
			useOrderConfirmation("sess-1", {
				initialConfirmation: { status: "completed", orderNumber: 777 } as never,
			});
			useTrackPurchase({ sessionId: "sess-1", orderNumber: 777 });
			return null;
		}
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<BothOwners />
			</Providers>,
		);
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(1);
	});

	it("treats a failed server snapshot as final, and reports nothing", async () => {
		const fake = createFakeFetch([]);
		const spy = spyDestination();
		function Failed() {
			const { status, loading, outcome } = useOrderConfirmation("sess-1", {
				initialConfirmation: { status: "failed", orderNumber: null } as never,
			});
			return <span>{`${loading}:${status}:${outcome?.kind}`}</span>;
		}
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<Failed />
			</Providers>,
		);
		expect(screen.getByText("false:failed:failed")).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fake.calls).toHaveLength(0);
		expect(eventsNamed(spy, "purchase")).toHaveLength(0);
	});

	it("polls from a non-terminal server snapshot and reports once on completion", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const spy = spyDestination();
		function Pending() {
			const { status, orderNumber } = useOrderConfirmation("sess-1", {
				initialConfirmation: {
					status: "processing_payment",
					orderNumber: null,
				} as never,
			});
			return <span>{`${status}:${orderNumber}`}</span>;
		}
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<Pending />
			</Providers>,
		);
		expect(screen.getByText("processing_payment:null")).toBeTruthy();
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
	});

	it("reports a reloaded thank-you page's order once, under the first visit's key", async () => {
		// A reload with the session id on the URL: the completed poll has
		// forgotten the session and its copy of the store id, so the second
		// mount must still find the shop's id and build the SAME key — or the
		// order is counted twice.
		const confirmed: FakeRoute = {
			match: "GET /v2/checkout/sessions/sess-1/confirmation",
			body: { status: "completed", orderNumber: 777 },
		};
		const session: FakeRoute = {
			match: "GET /v2/checkout/sessions/sess-1",
			body: SESSION,
		};
		const fake = createFakeFetch([confirmed, session, confirmed, session]);
		const client = makeClient(fake.fetch, await rememberedSession());
		const spy = spyDestination();
		const page = (
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<ThankYou sessionId="sess-1" />
			</Providers>
		);

		const firstVisit = render(page);
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		firstVisit.unmount();

		render(page);
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(1);
		expect(localStorage.getItem("qb_purchase_tracked_42_777")).toBeTruthy();
		expect(
			Object.keys(localStorage).filter((key) =>
				key.startsWith("qb_purchase_tracked_"),
			),
		).toEqual(["qb_purchase_tracked_42_777"]);
	});

	it("reports the order once when a header badge found the cart gone before the reload", async () => {
		// The usual thank-you page has a cart badge. On a redirect PSP the
		// platform has dropped the cart by the time the shopper is back, so the
		// badge's read is a 404 and the cart is forgotten. The store id noted
		// off that cart must survive it: once the completed poll has forgotten
		// the session's copy it is the only one left, and the reload builds the
		// dedup key from it. Losing it would key on the shop prefix instead, and
		// send a second `purchase`.
		function Badge() {
			const { itemCount } = useCart();
			return <span>{`items:${itemCount}`}</span>;
		}
		const confirmed: FakeRoute = {
			match: "GET /v2/checkout/sessions/sess-1/confirmation",
			body: { status: "completed", orderNumber: 777 },
		};
		const session: FakeRoute = {
			match: "GET /v2/checkout/sessions/sess-1",
			body: SESSION,
		};
		const gone: FakeRoute = {
			match: "GET /v2/cart/cart-1",
			status: 404,
			body: {},
		};
		const fake = createFakeFetch([
			confirmed,
			session,
			gone,
			confirmed,
			session,
		]);
		const storage = await rememberedSession();
		await storage.set("qb_cart_id", "cart-1");
		const client = makeClient(fake.fetch, storage);
		const spy = spyDestination();
		const page = (
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<Badge />
				<ThankYou sessionId="sess-1" />
			</Providers>
		);

		const firstVisit = render(page);
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await waitFor(() => expect(eventsNamed(spy, "purchase")).toHaveLength(1));
		await waitFor(() =>
			expect(
				fake.calls.filter((call) => call.url.endsWith("/cart/cart-1")),
			).toHaveLength(1),
		);
		expect(await storage.get("qb_cart_id")).toBeNull();
		firstVisit.unmount();

		render(page);
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(1);
		expect(
			Object.keys(localStorage).filter((key) =>
				key.startsWith("qb_purchase_tracked_"),
			),
		).toEqual(["qb_purchase_tracked_42_777"]);
	});

	it("does not report an order this browser already reported", async () => {
		localStorage.setItem("qb_purchase_tracked_42_777", String(Date.now()));
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const spy = spyDestination();
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<ThankYou />
			</Providers>,
		);

		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(0);
	});

	it("skips the purchase in inline success mode, where the frame reports it", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777, successMode: "inline" },
			},
		]);
		const spy = spyDestination();
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<ThankYou />
			</Providers>,
		);

		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(0);
		// Not even read: the session is only fetched to build the event.
		expect(
			fake.calls.some((call) => call.url.endsWith("/checkout/sessions/sess-1")),
		).toBe(false);
	});

	it("skips the purchase when told to", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
		]);
		const spy = spyDestination();
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fake.fetch, await rememberedSession())}
				destinations={[spy]}
			>
				<ThankYou trackPurchase={false} />
			</Providers>,
		);

		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(eventsNamed(spy, "purchase")).toHaveLength(0);
	});

	it("keeps confirming without analytics, exactly as before", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
		]);
		render(
			<ShopkitProvider
				client={makeClient(fake.fetch, await rememberedSession())}
				consent={false}
			>
				<ThankYou />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
		expect(fake.calls).toHaveLength(1);
	});

	function Track({
		onState,
		orderNumber = 777,
	}: {
		onState: (state: ReturnType<typeof useTrackPurchase>) => void;
		orderNumber?: number | null;
	}) {
		onState(useTrackPurchase({ sessionId: "sess-1", orderNumber }));
		return null;
	}

	it("useTrackPurchase reports once, then dedups on a later mount", async () => {
		const seen: ReturnType<typeof useTrackPurchase>[] = [];
		const spy = spyDestination();
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		const { unmount } = render(
			<StrictMode>
				<Providers
					store={undecidedStore()}
					client={makeClient(fake.fetch, await rememberedSession())}
					destinations={[spy]}
				>
					<Track onState={(state) => seen.push(state)} />
				</Providers>
			</StrictMode>,
		);

		await waitFor(() => expect(seen.at(-1)?.tracked).toBe(true));
		expect(seen.at(-1)?.error).toBeNull();
		expect(eventsNamed(spy, "purchase")).toHaveLength(1);
		expect(eventsNamed(spy, "purchase")[0]?.params).toEqual(
			EXPECTED_PURCHASE_PARAMS,
		);
		expect(localStorage.getItem("qb_purchase_tracked_42_777")).toBeTruthy();
		expect(fake.calls).toHaveLength(1);
		unmount();

		// A reload: a fresh hub in the same browser.
		const again: ReturnType<typeof useTrackPurchase>[] = [];
		const spyAgain = spyDestination();
		const fakeAgain = createFakeFetch([
			{ match: "GET /v2/checkout/sessions/sess-1", body: SESSION },
		]);
		render(
			<Providers
				store={undecidedStore()}
				client={makeClient(fakeAgain.fetch, await rememberedSession())}
				destinations={[spyAgain]}
			>
				<Track onState={(state) => again.push(state)} />
			</Providers>,
		);

		await waitFor(() => expect(again.at(-1)?.tracked).toBe(true));
		expect(eventsNamed(spyAgain, "purchase")).toHaveLength(0);
	});

	it("useTrackPurchase waits for an order number and surfaces a session without order data", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const seen: ReturnType<typeof useTrackPurchase>[] = [];
		const spy = spyDestination();
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1",
				body: { ...SESSION, data: {} },
			},
		]);
		const client = makeClient(fake.fetch, await rememberedSession());
		const tree = (orderNumber: number | null) => (
			<Providers store={undecidedStore()} client={client} destinations={[spy]}>
				<Track
					onState={(state) => seen.push(state)}
					orderNumber={orderNumber}
				/>
			</Providers>
		);
		const { rerender } = render(tree(null));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(fake.calls).toHaveLength(0);
		expect(seen.at(-1)).toEqual({ tracked: false, error: null });

		rerender(tree(777));

		await waitFor(() => expect(seen.at(-1)?.error).toBeTruthy());
		expect(seen.at(-1)?.error?.message).toMatch(/no order data/);
		expect(seen.at(-1)?.tracked).toBe(false);
		expect(eventsNamed(spy, "purchase")).toHaveLength(0);
	});
});
