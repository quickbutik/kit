import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactElement, StrictMode } from "react";
// @ts-expect-error: react-dom ships no types of its own and this package does
// not install @types/react-dom; one function each is all the SSR tests need.
import { hydrateRoot as untypedHydrateRoot } from "react-dom/client";
// @ts-expect-error: as above.
import { renderToString as untypedRenderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Analytics } from "../src/analytics/analytics.js";
import type { AnalyticsDestination } from "../src/analytics/destination.js";
import {
	googleTagDestination,
	resetGoogleTags,
} from "../src/analytics/destinations/google-tag.js";
import { resetMetaPixels } from "../src/analytics/destinations/meta-pixel.js";
import { resetInjectedScripts } from "../src/analytics/script.js";
import { serializeConsentState } from "../src/consent/cookie.js";
import { ConsentStore } from "../src/consent/store.js";
import { CONSENT_STYLE_ID } from "../src/consent/styles.js";
import type { ConsentState } from "../src/consent/types.js";
import {
	AnalyticsProvider,
	useOptionalAnalytics,
} from "../src/react/analytics.js";
import {
	ConsentBanner,
	ConsentProvider,
	ConsentSettingsButton,
	useOptionalConsent,
	useOptionalConsentStore,
} from "../src/react/consent.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { useCart } from "../src/react/use-cart.js";
import {
	useCheckout,
	useOrderConfirmation,
} from "../src/react/use-checkout.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { ShopkitConfig } from "../src/sdk/config.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

const renderToString = untypedRenderToString as (
	element: ReactElement,
) => string;
const hydrateRoot = untypedHydrateRoot as (
	container: Element,
	element: ReactElement,
) => { unmount(): void };

/**
 * `<ShopkitProvider>` with consent and analytics on by default: what it
 * mounts, how each piece is turned off, and how nested providers share one
 * store, one banner and one hub.
 */

const SHOP_ROUTE: FakeRoute = {
	match: "GET /v2/checkout/shop",
	body: {
		name: "Shop",
		brand: { logo: null, color: { primary: null } },
		tracking: {
			ga4MeasurementId: null,
			gtmContainerId: null,
			metaPixelId: null,
			metaCapiEnabled: false,
		},
	},
};

const DECIDED: ConsentState = {
	status: "decided",
	analytics: true,
	marketing: false,
	decidedAt: "2026-10-01T10:00:00.000Z",
	revision: 1,
};

function makeClient(
	routes: FakeRoute[] = [SHOP_ROUTE, SHOP_ROUTE],
	extra: Partial<ShopkitConfig> = {},
) {
	const fake = createFakeFetch(routes);
	const client = createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fake.fetch,
		storage: createMemoryStorage(),
		maxRetries: 0,
		...extra,
	});
	return { client, fake };
}

interface Seen {
	store: ConsentStore | null;
	hub: Analytics | null;
}

/** What the tree below sees: the consent store and the analytics hub. */
function Probe({ onRender }: { onRender: (seen: Seen) => void }) {
	onRender({ store: useOptionalConsentStore(), hub: useOptionalAnalytics() });
	return null;
}

function dialogs(): HTMLElement[] {
	return screen.queryAllByRole("dialog");
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
	localStorage.clear();
	document.documentElement.lang = "";
	// The banner's <style> stays: React remembers a hoisted stylesheet per
	// document and would not put a removed one back.
	for (const node of document.head.querySelectorAll("[data-qb-analytics]")) {
		node.remove();
	}
	resetInjectedScripts();
	resetGoogleTags();
	resetMetaPixels();
	const w = window as unknown as Record<string, unknown>;
	delete w.dataLayer;
	delete w.gtag;
	delete w.fbq;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("<ShopkitProvider> defaults", () => {
	it("mounts a consent store, an analytics hub and the default banner", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { client, fake } = makeClient();
		let seen = null as Seen | null;
		render(
			<ShopkitProvider client={client}>
				<Probe onRender={(value) => (seen = value)} />
			</ShopkitProvider>,
		);

		expect(seen?.store).toBeInstanceOf(ConsentStore);
		expect(seen?.hub).not.toBeNull();
		expect(seen?.hub?.consentState?.status).toBe("undecided");
		expect(dialogs()).toHaveLength(1);
		// The shop's own tracking ids are read once, for the hub.
		await waitFor(() =>
			expect(
				fake.calls.filter((call) => call.url.endsWith("/checkout/shop")),
			).toHaveLength(1),
		);
	});

	it("restores the pre-consent behaviour exactly with consent: false in the config", async () => {
		const routes: FakeRoute[] = [
			{
				match: "GET /v2/cart/cart-1",
				body: cartEnvelope({ storeId: 42 }),
			},
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
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
				},
			},
		];
		const { client, fake } = makeClient(routes, { consent: false });
		await client.storage.set("qb_cart_id", "cart-1");
		let seen = null as Seen | null;
		let start = null as ReturnType<typeof useCheckout>["start"] | null;
		function Start() {
			start = useCheckout().start;
			return null;
		}
		render(
			<ShopkitProvider client={client}>
				<Probe onRender={(value) => (seen = value)} />
				<Start />
			</ShopkitProvider>,
		);

		expect(seen?.store).toBeNull();
		expect(seen?.hub).toBeNull();
		expect(dialogs()).toHaveLength(0);

		let url: string | undefined;
		await act(async () => {
			const result = await start?.({
				cartId: "cart-1",
				successUrl: "https://myshop.test/order",
			});
			url = result?.url;
		});
		expect(url).toBe("https://checkout.test/checkout/42/sess-1");
		// No request for the shop's tracking ids: nothing to load them into.
		expect(fake.calls.some((call) => call.url.endsWith("/checkout/shop"))).toBe(
			false,
		);
	});

	it("forwards the decision on the checkout URL by default, once", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const routes: FakeRoute[] = [
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ storeId: 42 }) },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					sessionId: "sess-1",
					cartId: "cart-1",
					successUrl: "https://myshop.test/order",
					fields: {},
					data: {},
					checkout: "v2",
					hostedUrl: "https://checkout.test/checkout/42/sess-1",
				},
			},
		];
		const { client } = makeClient(routes);
		let start = null as ReturnType<typeof useCheckout>["start"] | null;
		function Start() {
			start = useCheckout().start;
			return null;
		}
		render(
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Start />
			</ShopkitProvider>,
		);
		let url = "";
		await act(async () => {
			const result = await start?.({
				cartId: "cart-1",
				successUrl: "https://myshop.test/order",
			});
			url = result?.url ?? "";
		});
		expect(new URL(url).searchParams.getAll("consentCategories")).toEqual([
			"analytics",
		]);
	});

	it("ignores consent options when the config says consent: false, and says so", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { client } = makeClient(undefined, { consent: false });
		render(
			<ShopkitProvider client={client} consent={{ lang: "sv" }}>
				x
			</ShopkitProvider>,
		);
		expect(dialogs()).toHaveLength(0);
		expect(
			warn.mock.calls.some((call) => String(call[0]).includes("ignored")),
		).toBe(true);
	});

	it("still honours the deprecated consent={false} prop, warning that the server does not", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		let seen = null as Seen | null;
		render(
			<ShopkitProvider client={makeClient([]).client} consent={false}>
				<Probe onRender={(value) => (seen = value)} />
			</ShopkitProvider>,
		);
		expect(seen?.store).toBeNull();
		expect(dialogs()).toHaveLength(0);
		expect(
			warn.mock.calls.some((call) => String(call[0]).includes("deprecated")),
		).toBe(true);
	});

	it("keeps the banner and loads no pixel with analytics: false", () => {
		const { client, fake } = makeClient();
		let seen = null as Seen | null;
		render(
			<ShopkitProvider client={client} consent={{ analytics: false }}>
				<Probe onRender={(value) => (seen = value)} />
			</ShopkitProvider>,
		);
		expect(seen?.store).toBeInstanceOf(ConsentStore);
		expect(seen?.hub).toBeNull();
		expect(dialogs()).toHaveLength(1);
		expect(fake.calls).toHaveLength(0);
	});

	it("passes analytics options and extra destinations to the hub", async () => {
		const destination: AnalyticsDestination = {
			id: "spy",
			requires: null,
			track: vi.fn(),
		};
		const { client, fake } = makeClient();
		let seen = null as Analytics | null;
		render(
			<ShopkitProvider
				client={client}
				consent={{ analytics: { auto: false, destinations: [destination] } }}
			>
				<Probe onRender={(value) => (seen = value.hub)} />
			</ShopkitProvider>,
		);
		act(() => seen?.track({ name: "page_view", params: {} }));
		expect(destination.track).toHaveBeenCalledTimes(1);
		expect(fake.calls).toHaveLength(0);
	});

	it("renders no banner with banner: false, and the render prop in its place", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { client } = makeClient();
		const { unmount } = render(
			<ShopkitProvider client={client} consent={{ banner: false }}>
				x
			</ShopkitProvider>,
		);
		expect(dialogs()).toHaveLength(0);
		unmount();

		render(
			<ShopkitProvider
				client={makeClient().client}
				consent={{
					banner: ({ visible, acceptAll }) =>
						visible ? (
							<button type="button" onClick={acceptAll}>
								Mine
							</button>
						) : null,
				}}
			>
				x
			</ShopkitProvider>,
		);
		expect(dialogs()).toHaveLength(0);
		fireEvent.click(screen.getByText("Mine"));
		expect(screen.queryByText("Mine")).toBeNull();
	});

	it("uses the provider's lang and privacy link for the default banner", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		render(
			<ShopkitProvider
				client={makeClient().client}
				consent={{ lang: "sv", privacyPolicyUrl: "/integritet" }}
			>
				x
			</ShopkitProvider>,
		);
		expect(screen.getByText("Vi använder cookies")).toBeTruthy();
		expect(screen.getByText("Integritetspolicy").getAttribute("href")).toBe(
			"/integritet",
		);
	});

	it("takes the revision from the config, and lets the prop override it", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		let store = null as ConsentStore | null;
		const { unmount } = render(
			<ShopkitProvider
				client={makeClient(undefined, { consent: { revision: 4 } }).client}
			>
				<Probe onRender={(value) => (store = value.store)} />
			</ShopkitProvider>,
		);
		expect(store?.revision).toBe(4);
		unmount();

		render(
			<ShopkitProvider
				client={makeClient(undefined, { consent: { revision: 4 } }).client}
				consent={{ revision: 5 }}
			>
				<Probe onRender={(value) => (store = value.store)} />
			</ShopkitProvider>,
		);
		expect(store?.revision).toBe(5);
	});

	it("renders the banner on the server from initialState, and nothing for a shopper who decided", () => {
		const { client } = makeClient([]);
		const undecided = renderToString(
			<ShopkitProvider
				client={client}
				consent={{
					lang: "sv",
					initialState: { ...DECIDED, status: "undecided", analytics: false },
				}}
			>
				x
			</ShopkitProvider>,
		);
		expect(undecided).toContain('role="dialog"');
		// Styled from the first byte: the stylesheet is in the server HTML.
		expect(undecided).toContain("@layer qb-consent");

		const decided = renderToString(
			<ShopkitProvider
				client={client}
				consent={{ lang: "sv", initialState: DECIDED }}
			>
				x
			</ShopkitProvider>,
		);
		expect(decided).not.toContain('role="dialog"');
	});

	it("reads the decision from the cookie in the browser: no banner once decided", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		// biome-ignore lint/suspicious/noDocumentCookie: the decision a returning shopper's browser holds.
		document.cookie = `qb_consent=${encodeURIComponent(serializeConsentState(DECIDED))}; path=/`;
		render(<ShopkitProvider client={makeClient().client}>x</ShopkitProvider>);
		expect(dialogs()).toHaveLength(0);
	});
});

describe("<ShopkitProvider> nesting", () => {
	it("shares one store, one banner and one hub with a provider nested inside it", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const outer = makeClient();
		const inner = makeClient([]);
		const seen: Seen[] = [];
		render(
			<ShopkitProvider client={outer.client}>
				<Probe onRender={(value) => seen.push(value)} />
				<ShopkitProvider client={inner.client}>
					<Probe onRender={(value) => seen.push(value)} />
				</ShopkitProvider>
			</ShopkitProvider>,
		);

		const outerSeen = seen[0];
		const innerSeen = seen[1];
		expect(innerSeen?.store).toBe(outerSeen?.store);
		expect(innerSeen?.hub).toBe(outerSeen?.hub);
		expect(dialogs()).toHaveLength(1);
		await waitFor(() =>
			expect(
				outer.fake.calls.filter((call) => call.url.endsWith("/checkout/shop")),
			).toHaveLength(1),
		);
		// The inner client never loads the pixels a second time.
		expect(inner.fake.calls).toHaveLength(0);
	});

	it("reports the nested provider's cart through the shared hub", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const destination = {
			id: "spy",
			requires: null,
			track: vi.fn(),
		} satisfies AnalyticsDestination;
		const outer = makeClient();
		const inner = makeClient([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({
					items: [cartLine()],
					itemCount: 1,
					total: 9900,
				}),
			},
		]);
		let add = null as ReturnType<typeof useCart>["add"] | null;
		function AddButton() {
			add = useCart().add;
			return null;
		}
		render(
			<ShopkitProvider
				client={outer.client}
				consent={{
					initialState: DECIDED,
					analytics: { auto: false, destinations: [destination] },
				}}
			>
				<ShopkitProvider client={inner.client}>
					<AddButton />
				</ShopkitProvider>
			</ShopkitProvider>,
		);

		await act(async () => {
			await add?.({ productId: "prod_27", quantity: 1 });
		});
		await waitFor(() =>
			expect(
				destination.track.mock.calls.map((call) => call[0].name),
			).toContain("add_to_cart"),
		);
	});

	it("reuses a <ConsentProvider> above it and renders no banner of its own", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const store = new ConsentStore({ initialState: null, persist: false });
		let seen = null as ConsentStore | null;
		render(
			<ConsentProvider store={store}>
				<ShopkitProvider client={makeClient().client}>
					<Probe onRender={(value) => (seen = value.store)} />
				</ShopkitProvider>
			</ConsentProvider>,
		);
		expect(seen).toBe(store);
		expect(dialogs()).toHaveLength(0);
	});

	it("steps the default banner aside for an explicit <ConsentBanner> below it", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		render(
			<ShopkitProvider client={makeClient().client}>
				<ConsentBanner>{() => <p>Own banner</p>}</ConsentBanner>
			</ShopkitProvider>,
		);
		await waitFor(() => expect(dialogs()).toHaveLength(0));
		expect(screen.getByText("Own banner")).toBeTruthy();
	});

	it("joins an explicit <AnalyticsProvider> to its hub instead of building a second", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const destination: AnalyticsDestination = {
			id: "extra",
			requires: null,
			track: vi.fn(),
		};
		const hubs: Array<Analytics | null> = [];
		render(
			<ShopkitProvider
				client={makeClient().client}
				consent={{ analytics: { auto: false } }}
			>
				<Probe onRender={(value) => hubs.push(value.hub)} />
				<AnalyticsProvider destinations={[destination]} requireConsent={false}>
					<Probe onRender={(value) => hubs.push(value.hub)} />
				</AnalyticsProvider>
			</ShopkitProvider>,
		);
		expect(hubs[1]).toBe(hubs[0]);
		act(() => hubs[0]?.track({ name: "page_view", params: {} }));
		expect(destination.track).toHaveBeenCalledTimes(1);
		// The option it could not apply is named, not silently dropped.
		expect(
			warn.mock.calls.some((call) =>
				String(call[0]).includes("requireConsent"),
			),
		).toBe(true);
	});
});

describe("default banner styles", () => {
	it("are injected once, however many banners render", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const store = new ConsentStore({ initialState: null, persist: false });
		render(
			<ConsentProvider store={store}>
				<ConsentBanner />
				<ConsentBanner />
			</ConsentProvider>,
		);
		const styles = Array.from(document.querySelectorAll("style")).filter(
			(style) => style.textContent?.includes("@layer qb-consent"),
		);
		expect(styles).toHaveLength(1);
		expect(styles[0]?.getAttribute("data-href")).toBe(CONSENT_STYLE_ID);
	});

	it("are left out with unstyled, and the markup says so", () => {
		const html = renderToString(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{
					unstyled: true,
					initialState: { ...DECIDED, status: "undecided" },
				}}
			>
				x
			</ShopkitProvider>,
		);
		expect(html).toContain("qb-consent--unstyled");
		expect(html).not.toContain("@layer qb-consent");
	});
});

describe("<ConsentSettingsButton>", () => {
	it("renders a localized button that reopens the banner", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		render(
			<ShopkitProvider
				client={makeClient().client}
				consent={{ lang: "sv", initialState: DECIDED }}
			>
				<ConsentSettingsButton className="link" />
			</ShopkitProvider>,
		);
		expect(dialogs()).toHaveLength(0);
		const button = screen.getByText("Cookie-inställningar");
		expect(button.tagName).toBe("BUTTON");
		expect(button.getAttribute("type")).toBe("button");
		expect(button.className).toBe("link");

		fireEvent.click(button);
		expect(dialogs()).toHaveLength(1);
	});

	it("takes children and its own lang, and lets onClick keep the panel shut", () => {
		const store = new ConsentStore({ initialState: DECIDED, persist: false });
		const onClick = vi.fn((event: { preventDefault: () => void }) =>
			event.preventDefault(),
		);
		render(
			<ConsentProvider store={store}>
				<ConsentSettingsButton lang="da" />
				<ConsentSettingsButton onClick={onClick}>Mine</ConsentSettingsButton>
			</ConsentProvider>,
		);
		expect(screen.getByText("Cookie-indstillinger")).toBeTruthy();
		fireEvent.click(screen.getByText("Mine"));
		expect(onClick).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().open).toBe(false);
	});

	it("renders nothing without a consent provider", () => {
		const { container } = render(<ConsentSettingsButton />);
		expect(container.innerHTML).toBe("");
	});

	it("reads the same decision useOptionalConsent does", () => {
		let status: string | undefined;
		function Status() {
			status = useOptionalConsent()?.status;
			return null;
		}
		render(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ initialState: DECIDED, analytics: false }}
			>
				<Status />
			</ShopkitProvider>,
		);
		expect(status).toBe("decided");
	});
});

describe("review fixes", () => {
	it("keeps an identical inline destination across 3 rerenders: one destination, no replay, removed on unmount", () => {
		let hub = null as Analytics | null;
		const { client } = makeClient([]);
		const tree = (withExtra: boolean) => (
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => (hub = value.hub)} />
				{withExtra ? (
					// A new array of a new object on every render, same config.
					<AnalyticsProvider
						destinations={[
							googleTagDestination({ ga4MeasurementId: "G-JOIN" }),
						]}
					>
						x
					</AnalyticsProvider>
				) : null}
			</ShopkitProvider>
		);
		const { rerender } = render(tree(true));
		act(() => hub?.track({ name: "page_view", params: {} }));
		rerender(tree(true));
		rerender(tree(true));
		rerender(tree(true));
		expect(hub?.destinations.filter((d) => d.id === "google")).toHaveLength(1);
		const events = (
			(window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []
		).filter(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as ArrayLike<unknown>)[0] === "event",
		);
		expect(events).toHaveLength(1);

		rerender(tree(false));
		expect(hub?.destinations.some((d) => d.id === "google")).toBe(false);
	});

	it("swaps a joined destination whose configuration changed (an id that loaded late)", () => {
		let hub = null as Analytics | null;
		const { client } = makeClient([]);
		const tree = (ga4: string | null) => (
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => (hub = value.hub)} />
				<AnalyticsProvider
					destinations={[googleTagDestination({ ga4MeasurementId: ga4 })]}
				>
					x
				</AnalyticsProvider>
			</ShopkitProvider>
		);
		const { rerender } = render(tree(null));
		const before = hub?.destinations.find((d) => d.id === "google");
		rerender(tree("G-LATE"));
		const after = hub?.destinations.filter((d) => d.id === "google") ?? [];
		expect(after).toHaveLength(1);
		expect(after[0]).not.toBe(before);
		expect(after[0]?.key).toContain("G-LATE");
	});

	it("removes the right one of two destinations that share an id", () => {
		let hub = null as Analytics | null;
		const { client } = makeClient([]);
		const a: AnalyticsDestination = {
			id: "spy",
			requires: null,
			track: vi.fn(),
		};
		const b: AnalyticsDestination = {
			id: "spy",
			requires: null,
			track: vi.fn(),
		};
		const tree = (destinations: AnalyticsDestination[]) => (
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => (hub = value.hub)} />
				<AnalyticsProvider destinations={destinations}>x</AnalyticsProvider>
			</ShopkitProvider>
		);
		const { rerender } = render(tree([a, b]));
		expect(hub?.destinations).toEqual([a, b]);
		rerender(tree([b]));
		expect(hub?.destinations).toEqual([b]);
	});

	it("shares one store and one banner with a <ConsentProvider> inside the shop provider, and its accept unlocks the hub", () => {
		const spy: AnalyticsDestination = {
			id: "spy",
			requires: "analytics",
			track: vi.fn(),
		};
		let hub = null as Analytics | null;
		render(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ initialState: null, analytics: { auto: false } }}
			>
				<ConsentProvider initialState={null}>
					<AnalyticsProvider destinations={[spy]}>
						<Probe onRender={(value) => (hub = value.hub)} />
					</AnalyticsProvider>
					<ConsentBanner lang="en" />
				</ConsentProvider>
			</ShopkitProvider>,
		);
		expect(dialogs()).toHaveLength(1);
		act(() => hub?.track({ name: "page_view", params: {} }));
		expect(spy.track).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("Accept all"));
		expect(dialogs()).toHaveLength(0);
		expect(spy.track).toHaveBeenCalledTimes(1);
	});

	it("gives a nested provider for another shop a hub of its own, under the same consent store", () => {
		const seen: Seen[] = [];
		const other = createShopkitClient({
			publishableKey: "qb_pk_other1_abcdef0123456789abcdef0123456789",
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			storage: createMemoryStorage(),
			maxRetries: 0,
		});
		render(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => seen.push(value)} />
				<ShopkitProvider
					client={other}
					consent={{ analytics: { auto: false } }}
				>
					<Probe onRender={(value) => seen.push(value)} />
				</ShopkitProvider>
			</ShopkitProvider>,
		);
		expect(seen[1]?.store).toBe(seen[0]?.store);
		expect(seen[1]?.hub).not.toBeNull();
		expect(seen[1]?.hub).not.toBe(seen[0]?.hub);
		expect(dialogs()).toHaveLength(0);
	});

	it("forgets the bought cart after a server-settled confirmation, so the next checkout starts a new cart", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/cart",
				status: 201,
				body: cartEnvelope({ id: "cart-2" }),
			},
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					sessionId: "sess-2",
					cartId: "cart-2",
					successUrl: "https://myshop.test/order",
					fields: {},
					data: {},
					checkout: "v2",
					hostedUrl: "https://checkout.test/checkout/42/sess-2",
				},
			},
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		await storage.set("qb_checkout_session", "sess-1");
		const client = createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fake.fetch,
			storage,
			maxRetries: 0,
			consent: false,
		});
		function ThankYou() {
			useOrderConfirmation("sess-1", {
				initialConfirmation: { status: "completed", orderNumber: 7 } as never,
			});
			return null;
		}
		render(
			<ShopkitProvider client={client}>
				<ThankYou />
			</ShopkitProvider>,
		);
		await waitFor(async () =>
			expect(await storage.get("qb_cart_id")).toBeNull(),
		);
		expect(await storage.get("qb_checkout_session")).toBeNull();

		await client.checkout.start({ successUrl: "https://myshop.test/order" });
		expect(fake.calls[0]?.method).toBe("POST");
		expect(new URL(fake.calls[0]?.url ?? "").pathname).toBe("/v2/cart");
	});

	it("hydrates without a mismatch under <html lang> when no lang is given", async () => {
		document.documentElement.lang = "sv";
		const element = (
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{
					initialState: { ...DECIDED, status: "undecided", analytics: false },
					analytics: false,
				}}
			>
				<ConsentSettingsButton />
			</ShopkitProvider>
		);
		const html = renderToString(element);
		// The server cannot see <html lang>: English, explicitly.
		expect(html).toContain("Cookie settings");
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let root: { unmount(): void } | null = null;
		await act(async () => {
			root = hydrateRoot(container, element);
		});
		expect(
			errors.mock.calls.filter((call) => /hydrat/i.test(String(call[0]))),
		).toEqual([]);
		// After hydration the copy follows the document's language.
		expect(container.textContent).toContain("Cookie-inställningar");
		expect(container.textContent).toContain("Vi använder cookies");
		act(() => root?.unmount());
		container.remove();
	});

	it("adopts an inner <ConsentProvider>'s initialState into the shared store, and warns about options it cannot apply", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const html = renderToString(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ lang: "en", analytics: false }}
			>
				<ConsentProvider
					initialState={DECIDED}
					persist={false}
					domain=".shop.test"
				>
					<span>page</span>
				</ConsentProvider>
			</ShopkitProvider>,
		);
		// Decided on the server: no banner in the HTML.
		expect(html).not.toContain('role="dialog"');
		const undecided = renderToString(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ lang: "en", analytics: false }}
			>
				<ConsentProvider
					initialState={{ ...DECIDED, status: "undecided", analytics: false }}
				>
					<span>page</span>
				</ConsentProvider>
			</ShopkitProvider>,
		);
		// Undecided on the server, and now known to be: the banner renders.
		expect(undecided).toContain('role="dialog"');
		const message = String(warn.mock.calls[0]?.[0]);
		expect(message).toContain("`persist`");
		expect(message).toContain("`domain`");
	});

	it("adds joined destinations that appear later, keeps the ones that stay, and drops the ones that go", () => {
		const first = (): AnalyticsDestination => ({
			id: "first",
			key: "first",
			requires: null,
			track: firstTrack,
		});
		const firstTrack = vi.fn();
		const second: AnalyticsDestination = {
			id: "second",
			requires: null,
			track: vi.fn(),
		};
		let hub = null as Analytics | null;
		const { client } = makeClient([]);
		const tree = (destinations: AnalyticsDestination[]) => (
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => (hub = value.hub)} />
				<AnalyticsProvider destinations={destinations}>x</AnalyticsProvider>
			</ShopkitProvider>
		);
		const { rerender } = render(tree([]));
		act(() => hub?.track({ name: "page_view", params: {} }));
		// Arrives late (ids loaded asynchronously): added, and given the history.
		rerender(tree([first()]));
		expect(hub?.destinations.map((d) => d.id)).toEqual(["first"]);
		expect(firstTrack).toHaveBeenCalledTimes(1);
		// Recreated inline on every render: kept, not replayed.
		rerender(tree([first(), second]));
		rerender(tree([first(), second]));
		expect(hub?.destinations.map((d) => d.id)).toEqual(["first", "second"]);
		expect(firstTrack).toHaveBeenCalledTimes(1);
		rerender(tree([second]));
		expect(hub?.destinations.map((d) => d.id)).toEqual(["second"]);
		rerender(tree([]));
		expect(hub?.destinations).toEqual([]);
	});

	it("never undoes a live decision when a <ConsentProvider initialState> mounts late", () => {
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		let store = null as ConsentStore | null;
		const { client } = makeClient([]);
		const tree = (late: boolean) => (
			<ShopkitProvider client={client} consent={{ analytics: false }}>
				<Probe onRender={(value) => (store = value.store)} />
				{late ? (
					<ConsentProvider initialState={null}>
						<span>late</span>
					</ConsentProvider>
				) : null}
			</ShopkitProvider>
		);
		const { rerender } = render(tree(false));
		act(() => store?.acceptAll());
		expect(dialogs()).toHaveLength(0);

		rerender(tree(true));
		expect(store?.getSnapshot().status).toBe("decided");
		expect(dialogs()).toHaveLength(0);
		expect(
			errors.mock.calls.filter((call) =>
				/Cannot update a component/.test(String(call[0])),
			),
		).toEqual([]);
	});

	it("adopts a nested initialState for hydration, StrictMode included, without a mismatch", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		// The browser holds the decision the server read.
		// biome-ignore lint/suspicious/noDocumentCookie: the cookie a returning shopper's browser sends.
		document.cookie = `qb_consent=${encodeURIComponent(serializeConsentState(DECIDED))}; path=/`;
		const element = (
			<StrictMode>
				<ShopkitProvider
					client={makeClient([]).client}
					consent={{ lang: "en", analytics: false }}
				>
					<ConsentProvider initialState={DECIDED}>
						<ConsentSettingsButton />
					</ConsentProvider>
				</ShopkitProvider>
			</StrictMode>
		);
		const html = renderToString(element);
		expect(html).not.toContain('role="dialog"');
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let root: { unmount(): void } | null = null;
		await act(async () => {
			root = hydrateRoot(container, element);
		});
		expect(errors.mock.calls).toEqual([]);
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		act(() => root?.unmount());
		container.remove();
	});

	it("applies a nested initialState in a client-only render with no cookie: decided, hub unlocked, no banner", () => {
		const spy: AnalyticsDestination = {
			id: "spy",
			requires: "analytics",
			track: vi.fn(),
		};
		let seen = null as Seen | null;
		render(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ analytics: { auto: false, destinations: [spy] } }}
			>
				<ConsentProvider initialState={DECIDED}>
					<Probe onRender={(value) => (seen = value)} />
				</ConsentProvider>
			</ShopkitProvider>,
		);
		expect(seen?.store?.getSnapshot().status).toBe("decided");
		expect(dialogs()).toHaveLength(0);
		act(() => seen?.hub?.track({ name: "page_view", params: {} }));
		expect(spy.track).toHaveBeenCalledTimes(1);
	});

	it("applies a nested initialState after SSR + hydration when the browser has no cookie", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const element = (
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ lang: "en", analytics: false }}
			>
				<ConsentProvider initialState={DECIDED}>
					<ConsentSettingsButton />
				</ConsentProvider>
			</ShopkitProvider>
		);
		const html = renderToString(element);
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let root: { unmount(): void } | null = null;
		await act(async () => {
			root = hydrateRoot(container, element);
		});
		expect(errors.mock.calls).toEqual([]);
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		act(() => root?.unmount());
		container.remove();
	});

	it("warns, and keeps the store's decision, when a nested initialState disagrees with it", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		// biome-ignore lint/suspicious/noDocumentCookie: the decision the browser already holds.
		document.cookie = `qb_consent=${encodeURIComponent(serializeConsentState({ ...DECIDED, analytics: false }))}; path=/`;
		let store = null as ConsentStore | null;
		render(
			<ShopkitProvider
				client={makeClient([]).client}
				consent={{ analytics: false }}
			>
				<ConsentProvider initialState={DECIDED}>
					<Probe onRender={(value) => (store = value.store)} />
				</ConsentProvider>
			</ShopkitProvider>,
		);
		expect(store?.getSnapshot().analytics).toBe(false);
		expect(
			warn.mock.calls.some((call) =>
				String(call[0]).includes("`initialState`"),
			),
		).toBe(true);
	});

	it("does not swap a Google destination when only gaLink arrives later: no duplicate event", () => {
		let hub = null as Analytics | null;
		const { client } = makeClient([]);
		const tree = (gaLink: { clientId: string } | null) => (
			<ShopkitProvider
				client={client}
				consent={{ initialState: DECIDED, analytics: { auto: false } }}
			>
				<Probe onRender={(value) => (hub = value.hub)} />
				<AnalyticsProvider
					destinations={[
						googleTagDestination({ ga4MeasurementId: "G-LINK", gaLink }),
					]}
				>
					x
				</AnalyticsProvider>
			</ShopkitProvider>
		);
		const { rerender } = render(tree(null));
		const before = hub?.destinations.find((d) => d.id === "google");
		act(() =>
			hub?.track({ name: "view_item", params: { currency: "SEK", value: 1 } }),
		);
		rerender(tree({ clientId: "123.456" }));
		expect(hub?.destinations.find((d) => d.id === "google")).toBe(before);
		const viewItems = (
			(window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []
		).filter(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as ArrayLike<unknown>)[1] === "view_item",
		);
		expect(viewItems).toHaveLength(1);
	});
});
