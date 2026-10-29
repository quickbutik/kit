import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_KEY } from "../helpers.js";
import { flush, resetDom } from "./helpers.js";

/**
 * The script-tag build reads `document.currentScript` at module evaluation, so
 * every case here has to plant a fake script tag and then import the module
 * fresh. `vi.resetModules()` between them is what makes that possible — and it
 * is also why the assertions read the ambient shop through the returned global
 * rather than through a statically imported `getAmbientShop`: the reset gives
 * the re-imported module its own copy of the singleton.
 */
async function loadGlobal(attributes: Record<string, string>) {
	const script = document.createElement("script");
	for (const [name, value] of Object.entries(attributes)) {
		script.setAttribute(name, value);
	}
	document.head.append(script);
	Object.defineProperty(document, "currentScript", {
		value: script,
		configurable: true,
	});

	vi.resetModules();
	await import("../../src/global.js");
	await flush();

	Object.defineProperty(document, "currentScript", {
		value: null,
		configurable: true,
	});
	script.remove();
	return window.Quickbutik;
}

describe("the script-tag build", () => {
	beforeEach(() => {
		resetDom();
		// @ts-expect-error — clearing the global between cases.
		window.Quickbutik = undefined;
	});

	afterEach(() => {
		vi.resetModules();
	});

	it("configures the shop from its own data-* attributes", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
			"data-currency": "SEK",
			"data-locale": "sv-SE",
		});

		expect(api).toBeTruthy();
		const shop = api.shop;
		expect(shop?.client.apiUrl).toBe("https://gateway.test");
		expect(shop?.currency).toBe("SEK");
		expect(shop?.locale).toBe("sv-SE");
		// The whole point: a page can use the elements with no <qb-shop> and
		// no JavaScript of its own.
		expect(api.client?.shopPrefix).toBe("shop123");
	});

	it("browses in data-currency and switches with Quickbutik.setCurrency", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-api-url": "https://gateway.test",
			"data-currency": "eur",
		});
		expect(api.currency).toBe("EUR");
		const seen: Array<string | null> = [];
		const stop = api.onCurrencyChange((code) => seen.push(code));
		await api.setCurrency("NOK");
		expect(api.currency).toBe("NOK");
		expect(seen).toEqual(["NOK"]);
		stop();
		expect(customElements.get("qb-currency-select")).toBeTruthy();
	});

	it("registers the elements", async () => {
		await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
		});

		expect(customElements.get("qb-product")).toBeTruthy();
		expect(customElements.get("qb-checkout-button")).toBeTruthy();
		expect(customElements.get("qb-buy-now")).toBeTruthy();
	});

	it("binds the ambient shop to data-storefront-id", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
			"data-storefront-id": "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD",
		});

		expect(api.client?.storefront).toEqual({
			id: "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD",
			surface: "shopkit",
		});
	});

	it("offers clearCart(), a no-op with nothing to clear", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
		});
		await expect(api.clearCart()).resolves.toBeUndefined();

		// @ts-expect-error — clearing the global between cases.
		window.Quickbutik = undefined;
		const unconfigured = await loadGlobal({});
		await expect(unconfigured.clearCart()).resolves.toBeUndefined();
	});

	it("exposes the SDK and the helpers on the global", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
		});

		expect(typeof api.configure).toBe("function");
		expect(typeof api.createShopkitClient).toBe("function");
		expect(typeof api.formatMoney).toBe("function");
		expect(typeof api.buildSeo).toBe("function");
		expect(api.cart).toBeTruthy();
		expect(api.formatMoney(129900, "SEK", { locale: "sv-SE" })).toMatch(
			/1[\s  ]299,00/,
		);
	});

	it("reports a malformed key instead of failing silently", async () => {
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		const api = await loadGlobal({ "data-publishable-key": "not-a-key" });

		expect(api.error).toBeInstanceOf(Error);
		expect(errors).toHaveBeenCalled();
		// …and the elements are still registered, so the page reports the problem
		// rather than rendering inert unknown tags.
		expect(api.defined).toBeTruthy();
		errors.mockRestore();
	});

	it("skips registration when told to", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
			"data-no-auto-define": "",
		});

		expect(api.defined).toBeNull();
	});

	it("does nothing at all without a key, leaving configure() to the page", async () => {
		const api = await loadGlobal({});

		expect(api.shop).toBeNull();
		expect(api.error).toBeNull();
		expect(api.client).toBeNull();
	});

	describe("consent and analytics", () => {
		function plantDecidedCookie(revision: number): void {
			const value = encodeURIComponent(
				JSON.stringify({
					rev: revision,
					analytics: true,
					marketing: true,
					decidedAt: "2026-01-01T00:00:00.000Z",
				}),
			);
			// biome-ignore lint/suspicious/noDocumentCookie: planting a raw cookie is the point; CookieStore is not in happy-dom.
			document.cookie = `qb_consent=${value}; path=/`;
		}

		it("mounts the consent banner and turns analytics on by default", async () => {
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("offline"));
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);
			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-consent-lang": "sv",
				"data-privacy-policy-url": "/integritet",
			});
			await flush();

			expect(api.analytics).not.toBeNull();
			const banners = document.querySelectorAll("qb-consent-banner");
			expect(banners).toHaveLength(1);
			expect(banners[0]?.getAttribute("lang")).toBe("sv");
			expect(banners[0]?.getAttribute("privacy-policy-url")).toBe(
				"/integritet",
			);
			fetchSpy.mockRestore();
			warn.mockRestore();
		});

		it('turns consent, the banner and analytics off with data-consent="false"', async () => {
			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-consent": "false",
			});
			await flush();

			expect(api.analytics).toBeNull();
			expect(document.querySelectorAll("qb-consent-banner")).toHaveLength(0);
			expect(api.client?.consent.enabled).toBe(false);
		});

		it('leaves analytics off with data-analytics="false"', async () => {
			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-analytics": "false",
			});

			expect(api.analytics).toBeNull();
			// Both are safe to call on a page that opted out.
			expect(() => api.track({ name: "page_view", params: {} })).not.toThrow();
			const actualTracked = api.trackPurchase(
				{
					transaction_id: "1001",
					value: 99,
					currency: "SEK",
					items: [],
				},
				{ orderNumber: 1001 },
			);
			expect(actualTracked).toBe(false);
		});

		it("builds the shop's analytics hub from data-analytics, gated on consent", async () => {
			// The hub asks the shop for its tracking ids on start; there is no
			// gateway here, and the warning that follows is the hub's business.
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("offline"));
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);

			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-analytics": "",
			});

			expect(api.analytics).toBeInstanceOf(api.Analytics);
			expect(api.analytics?.requireConsent).toBe(true);
			expect(api.shop?.analytics).toBe(api.analytics);
			fetchSpy.mockRestore();
			warn.mockRestore();
		});

		it("runs analytics ungated with data-analytics-require-consent=false", async () => {
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("offline"));
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);

			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-analytics": "",
				"data-analytics-require-consent": "false",
			});

			expect(api.analytics?.requireConsent).toBe(false);
			expect(api.analytics?.consentState).toBeNull();
			fetchSpy.mockRestore();
			warn.mockRestore();
		});

		it("creates the page's consent store on first use, reading the cookie", async () => {
			plantDecidedCookie(1);
			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-analytics": "false",
			});

			const consent = api.consent;
			expect(consent).toBeInstanceOf(api.ConsentStore);
			expect(consent.getSnapshot().status).toBe("decided");
			expect(consent.allows("marketing")).toBe(true);
			expect(api.consent).toBe(consent);
		});

		it("asks again when data-consent-revision moves past the stored decision", async () => {
			plantDecidedCookie(1);
			const api = await loadGlobal({
				"data-publishable-key": TEST_KEY,
				"data-api-url": "https://gateway.test",
				"data-consent-revision": "2",
				"data-consent-max-age-days": "30",
				"data-analytics": "false",
			});

			expect(api.consent.revision).toBe(2);
			expect(api.consent.getSnapshot().status).toBe("undecided");
			expect(api.consent.allows("analytics")).toBe(false);
		});

		it("exposes the consent and analytics building blocks", async () => {
			const api = await loadGlobal({});

			expect(typeof api.readConsentCookie).toBe("function");
			expect(typeof api.appendCheckoutHandoffParams).toBe("function");
			expect(typeof api.googleTagDestination).toBe("function");
			expect(typeof api.metaPixelDestination).toBe("function");
			expect(
				api.appendCheckoutHandoffParams(
					"https://checkout.test/checkout/42/s1",
					null,
					{ linkGa: false },
				),
			).toBe("https://checkout.test/checkout/42/s1?consentCategories=");
		});
	});

	it("lets a page swap in a client it built itself", async () => {
		const api = await loadGlobal({
			"data-publishable-key": TEST_KEY,
			"data-consent": "false",
			"data-api-url": "https://gateway.test",
		});

		const own = api.createShopkitClient({
			publishableKey: TEST_KEY,
			apiUrl: "https://other.test",
		});
		api.client = own;

		expect(api.shop?.client).toBe(own);
		expect(api.client?.apiUrl).toBe("https://other.test");
	});
});
