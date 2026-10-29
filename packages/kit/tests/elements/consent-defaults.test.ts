import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_STYLE_ID } from "../../src/consent/styles.js";
import {
	configure,
	decorateHandoff,
	getAmbientConsent,
	getAmbientShop,
	requireAmbientConsent,
	type ShopContextValue,
} from "../../src/elements/index.js";
import { createShopkitClient } from "../../src/sdk/client.js";
import { createFakeFetch, TEST_KEY } from "../helpers.js";
import { $, $$, ensureDefined, flush, mount, resetDom } from "./helpers.js";

/**
 * Consent and analytics on by default for the elements: the banner the kit
 * mounts for a configured page, the opt-outs, and the rule that a banner the
 * page places itself is the only one.
 */

ensureDefined();

const SHOP = {
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

function configureShop(
	extra: Partial<Parameters<typeof configure>[0]> = {},
): ShopContextValue {
	return configure({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: createFakeFetch([SHOP, SHOP, SHOP]).fetch,
		maxRetries: 0,
		...extra,
	});
}

function autoBanners(): HTMLElement[] {
	return $$(document, "qb-consent-banner[data-qb-auto]");
}

beforeEach(() => {
	resetDom();
	document.getElementById(CONSENT_STYLE_ID)?.remove();
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("configure() defaults", () => {
	it("mounts one styled consent banner and turns analytics on", async () => {
		const shop = configureShop();
		await flush();

		const banners = $$(document, "qb-consent-banner");
		expect(banners).toHaveLength(1);
		expect(banners[0]?.hasAttribute("data-qb-auto")).toBe(true);
		expect(banners[0]?.getAttribute("role")).toBe("dialog");
		expect(shop.analytics).not.toBeNull();
		expect(shop.client.consent.enabled).toBe(true);

		const styles = document.querySelectorAll(`#${CONSENT_STYLE_ID}`);
		expect(styles).toHaveLength(1);
		expect(styles[0]?.textContent).toContain("@layer qb-consent");
	});

	it("injects the stylesheet once, however many banners there are", async () => {
		configureShop();
		await mount(`<qb-consent-banner></qb-consent-banner>`);
		await mount(`<qb-consent-banner show-when-decided></qb-consent-banner>`);
		await flush();
		expect(document.querySelectorAll(`#${CONSENT_STYLE_ID}`)).toHaveLength(1);
	});

	it("hands the banner its lang and privacy link", async () => {
		configureShop({
			consent: { lang: "sv", privacyPolicyUrl: "/integritet", revision: 3 },
		});
		await flush();

		const banner = $(document, "qb-consent-banner");
		expect(banner.getAttribute("lang")).toBe("sv");
		expect(banner.getAttribute("privacy-policy-url")).toBe("/integritet");
		expect($(banner, ".qb-consent__title").textContent).toBe(
			"Vi använder cookies",
		);
		expect(getAmbientConsent()?.revision).toBe(3);
		expect(getAmbientShop()?.client.consent.revision).toBe(3);
	});

	it("leaves the stylesheet out with unstyled", async () => {
		configureShop({ consent: { unstyled: true } });
		await flush();
		const banner = $(document, "qb-consent-banner");
		expect(banner.classList.contains("qb-consent--unstyled")).toBe(true);
		expect(document.getElementById(CONSENT_STYLE_ID)).toBeNull();
	});

	it("mounts no banner, but keeps analytics, with banner: false", async () => {
		const shop = configureShop({ consent: { banner: false } });
		await flush();
		expect($$(document, "qb-consent-banner")).toHaveLength(0);
		expect(shop.analytics).not.toBeNull();
	});

	it("turns everything off with consent: false", async () => {
		const shop = configureShop({ consent: false });
		await flush();
		expect($$(document, "qb-consent-banner")).toHaveLength(0);
		expect(shop.analytics).toBeNull();
		expect(shop.client.consent.enabled).toBe(false);
	});

	it("keeps consent and turns analytics off with analytics: false", async () => {
		const shop = configureShop({ analytics: false });
		await flush();
		expect($$(document, "qb-consent-banner")).toHaveLength(1);
		expect(shop.analytics).toBeNull();
	});

	it("takes down the auto banner when configured again with consent: false", async () => {
		configureShop();
		await flush();
		expect(autoBanners()).toHaveLength(1);
		configureShop({ consent: false });
		await flush();
		expect($$(document, "qb-consent-banner")).toHaveLength(0);
	});
});

describe("one banner per page", () => {
	it("mounts none when the page already has its own", async () => {
		await mount(`<qb-consent-banner lang="sv"></qb-consent-banner>`);
		configureShop();
		await flush();
		const banners = $$(document, "qb-consent-banner");
		expect(banners).toHaveLength(1);
		expect(banners[0]?.hasAttribute("data-qb-auto")).toBe(false);
	});

	it("takes the auto banner down when the page places one later", async () => {
		configureShop();
		await flush();
		expect(autoBanners()).toHaveLength(1);

		await mount(
			`<qb-consent-banner><button data-qb-action="accept-all">OK</button></qb-consent-banner>`,
		);
		await flush();
		const banners = $$(document, "qb-consent-banner");
		expect(banners).toHaveLength(1);
		expect(banners[0]?.hasAttribute("data-qb-auto")).toBe(false);
	});

	it("does not mount a second auto banner when configured twice", async () => {
		configureShop();
		configureShop({ consent: { lang: "da" } });
		await flush();
		expect(autoBanners()).toHaveLength(1);
		expect(autoBanners()[0]?.getAttribute("lang")).toBe("da");
	});
});

describe("<qb-consent-settings>", () => {
	it("renders a localized button when empty, which reopens the banner", async () => {
		const host = await mount(
			`<qb-consent-settings lang="sv"></qb-consent-settings>`,
		);
		const button = $(host, "button");
		expect(button.getAttribute("type")).toBe("button");
		expect(button.textContent).toBe("Cookie-inställningar");

		button.click();
		expect(getAmbientConsent()?.getSnapshot().open).toBe(true);
	});

	it("keeps markup of its own", async () => {
		const host = await mount(
			`<qb-consent-settings><a href="#">Mine</a></qb-consent-settings>`,
		);
		expect($$(host, "button")).toHaveLength(0);
	});

	it("hides itself when the page turned consent off", async () => {
		configureShop({ consent: false });
		const host = await mount(`<qb-consent-settings></qb-consent-settings>`);
		expect($(host, "qb-consent-settings").hidden).toBe(true);
	});
});

describe("<qb-shop> defaults", () => {
	it("builds a hub and mounts the banner without any attribute", async () => {
		const fake = createFakeFetch([SHOP]);
		const ready = vi.fn();
		document.addEventListener("qb:shop-ready", ready);
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" privacy-policy-url="/p"></qb-shop>`,
			(host) => {
				// A client with the fake fetch, so the hub's shop read is answered.
				(
					host.querySelector("qb-shop") as HTMLElement & { client: unknown }
				).client = getClient(fake.fetch);
			},
		);
		await flush();
		document.removeEventListener("qb:shop-ready", ready);

		const value = ready.mock.calls.at(-1)?.[0].detail as ShopContextValue;
		expect(value.analytics).not.toBeNull();
		expect(autoBanners()).toHaveLength(1);
		expect(autoBanners()[0]?.getAttribute("privacy-policy-url")).toBe("/p");
	});

	it('builds no hub and mounts no banner with consent="false"', async () => {
		const ready = vi.fn();
		document.addEventListener("qb:shop-ready", ready);
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" consent="false"></qb-shop>`,
		);
		await flush();
		document.removeEventListener("qb:shop-ready", ready);
		const value = ready.mock.calls.at(-1)?.[0].detail as ShopContextValue;
		expect(value.analytics).toBeNull();
		expect($$(document, "qb-consent-banner")).toHaveLength(0);
	});

	it("reuses the page's hub for the same shop instead of loading it twice", async () => {
		const page = configureShop();
		const ready = vi.fn();
		document.addEventListener("qb:shop-ready", ready);
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" storefront-id="sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD"></qb-shop>`,
		);
		await flush();
		document.removeEventListener("qb:shop-ready", ready);
		const value = ready.mock.calls.at(-1)?.[0].detail as ShopContextValue;
		expect(value.analytics).toBe(page.analytics);
		expect(autoBanners()).toHaveLength(1);

		// Taking the subtree out must not take the page's hub with it.
		const hub = page.analytics;
		if (!hub) throw new Error("the page has no hub");
		const destroy = vi.spyOn(hub, "destroy");
		$(document, "qb-shop").remove();
		expect(destroy).not.toHaveBeenCalled();
	});
});

function getClient(fetchImpl: typeof globalThis.fetch) {
	return createShopkitClient({
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		maxRetries: 0,
	});
}

describe("page-level banner settings win over <qb-shop>", () => {
	it("does not bring back a banner the page turned off", async () => {
		configureShop({ consent: { banner: false } });
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" analytics="false"></qb-shop>`,
		);
		await flush();
		expect($$(document, "qb-consent-banner")).toHaveLength(0);
	});

	it("keeps the page's lang, privacy link and unstyled over a shop's", async () => {
		configureShop({
			consent: { lang: "sv", privacyPolicyUrl: "/integritet", unstyled: true },
		});
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" analytics="false" lang="da" privacy-policy-url="/other"></qb-shop>`,
		);
		await flush();
		const banner = $(document, "qb-consent-banner");
		expect(banner.getAttribute("lang")).toBe("sv");
		expect(banner.getAttribute("privacy-policy-url")).toBe("/integritet");
		expect(banner.hasAttribute("unstyled")).toBe(true);
	});

	it("lets a shop fill in what the page left out", async () => {
		configureShop();
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" analytics="false" privacy-policy-url="/from-shop"></qb-shop>`,
		);
		await flush();
		expect(
			$(document, "qb-consent-banner").getAttribute("privacy-policy-url"),
		).toBe("/from-shop");
	});

	it('leaves checkout URLs from a <qb-shop consent="false"> subtree untouched', async () => {
		await mount(
			`<qb-shop publishable-key="${TEST_KEY}" api-url="https://gateway.test" consent="false"></qb-shop>`,
		);
		await flush();
		const shop = $(document, "qb-shop") as HTMLElement & {
			client: { consent: { enabled: boolean } } | null;
		};
		expect(shop.client?.consent.enabled).toBe(false);
		// Even with a consent store on the page, its handoffs are left alone.
		requireAmbientConsent().acceptAll();
		const decorated = decorateHandoff(
			{ url: "https://checkout.test/checkout/42/s1" },
			{ client: shop.client } as unknown as ShopContextValue,
		);
		expect(decorated.url).toBe("https://checkout.test/checkout/42/s1");
	});
});
