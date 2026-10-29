import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	configure,
	getAmbientShop,
	setCurrency,
} from "../../src/elements/index.js";
import type { Product } from "../../src/sdk/types/catalog.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	ensureDefined,
	flush,
	makeClient,
	mount,
	PRODUCT,
	resetDom,
	SIMPLE_PRODUCT,
	text,
} from "./helpers.js";

ensureDefined();

const SHOP = {
	name: "Shop",
	brand: { logo: null, color: { primary: null } },
	currency: "SEK",
	currencies: [
		{ code: "SEK", mode: "base", rate: 1 },
		{ code: "EUR", mode: "charge", rate: 0.0871 },
		{ code: "NOK", mode: "display", rate: 0.95 },
	],
};

const BASE_ONLY = {
	...SHOP,
	currencies: [{ code: "SEK", mode: "base", rate: 1 }],
};

function page(products: Product[]) {
	return { data: products, has_more: false, next_cursor: null };
}

function eur(product: Product): Product {
	return { ...product, currency: "EUR", price: 862 };
}

function sek(product: Product): Product {
	return { ...product, currency: "SEK" };
}

function sentCurrency(url: string): string | null {
	return new URL(url).searchParams.get("currency");
}

function setup(
	routes: Parameters<typeof createFakeFetch>[0],
	currency?: string,
) {
	const fake = createFakeFetch(routes);
	configure({
		// Consent and analytics are on by default; this suite tests currencies
		// without them (they have their own suites).
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fake.fetch,
		locale: "sv-SE",
		maxRetries: 0,
		...(currency && { currency }),
	});
	return fake;
}

describe("<qb-currency-select>", () => {
	beforeEach(resetDom);

	it("adds a native <select> of the shop's currencies and switches on change", async () => {
		const fake = setup([{ match: "GET /v2/checkout/shop", body: SHOP }]);
		const host = await mount("<qb-currency-select></qb-currency-select>");
		await flush(4);

		const element = $(host, "qb-currency-select");
		const select = $(host, "select") as HTMLSelectElement;
		expect(Array.from(select.options).map((o) => o.value)).toEqual([
			"SEK",
			"EUR",
			"NOK",
		]);
		expect(select.value).toBe("SEK");
		expect(element.getAttribute("data-mode")).toBe("base");
		expect(element.hasAttribute("empty")).toBe(false);

		const changed = vi.fn();
		element.addEventListener("qb:currency-change", (event) =>
			changed((event as CustomEvent).detail),
		);
		select.value = "NOK";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		await flush(4);

		expect(getAmbientShop()?.client.currency).toBe("NOK");
		expect(changed).toHaveBeenCalledWith({ currency: "NOK" });
		expect(element.getAttribute("data-currency")).toBe("NOK");
		expect(element.getAttribute("data-mode")).toBe("display");
		expect(fake.calls).toHaveLength(1);
	});

	it("fills the author's own <select>, keeping a placeholder", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: SHOP }], "EUR");
		const host = await mount(`
			<qb-currency-select label="code-name" locale="en">
				<select class="mine"><option value="">Currency</option></select>
			</qb-currency-select>
		`);
		await flush(4);

		const select = $(host, "select.mine") as HTMLSelectElement;
		expect($$(host, "select")).toHaveLength(1);
		expect(Array.from(select.options).map((o) => o.value)).toEqual([
			"",
			"SEK",
			"EUR",
			"NOK",
		]);
		expect(select.value).toBe("EUR");
		expect(select.options[2]?.textContent).toMatch(/^EUR – /);
	});

	it("leaves an authored lower-case <select> enabled and matches it", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: SHOP }], "EUR");
		const host = await mount(`
			<qb-currency-select>
				<select><option value="sek">kr</option><option value="eur">€</option></select>
			</qb-currency-select>
		`);
		const select = $(host, "select") as HTMLSelectElement;
		expect(select.disabled).toBe(false);
		await flush(4);
		expect(select.disabled).toBe(false);
		expect(select.value).toBe("eur");
	});

	it("adds no <select> next to static set-currency buttons", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: SHOP }]);
		const host = await mount(`
			<qb-currency-select>
				<button data-qb-action="set-currency" data-qb-currency="EUR">EUR</button>
			</qb-currency-select>
		`);
		await flush(4);
		expect($$(host, "select")).toHaveLength(0);
		($(host, "button") as HTMLButtonElement).click();
		await flush(4);
		expect(getAmbientShop()?.client.currency).toBe("EUR");
	});

	it("repeats a <template> per currency with a set-currency action", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: SHOP }]);
		const host = await mount(`
			<qb-currency-select>
				<template>
					<button class="cur" data-qb-action="set-currency" data-qb-text="option.code"></button>
				</template>
			</qb-currency-select>
		`);
		await flush(4);

		const buttons = $$(host, "button.cur");
		expect(buttons.map((b) => b.textContent)).toEqual(["SEK", "EUR", "NOK"]);
		expect(buttons[0]?.getAttribute("data-selected")).toBe("true");
		expect($$(host, "select")).toHaveLength(0);

		buttons[1]?.click();
		await flush(4);
		expect(getAmbientShop()?.client.currency).toBe("EUR");
		expect($$(host, "button.cur")[1]?.getAttribute("aria-pressed")).toBe(
			"true",
		);
	});

	it("reflects `empty` when the shop offers only its own currency", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: BASE_ONLY }]);
		const host = await mount("<qb-currency-select></qb-currency-select>");
		await flush(4);
		expect($(host, "qb-currency-select").hasAttribute("empty")).toBe(true);
	});

	it("follows a switch made elsewhere on the page", async () => {
		setup([{ match: "GET /v2/checkout/shop", body: SHOP }]);
		const host = await mount("<qb-currency-select></qb-currency-select>");
		await flush(4);
		await setCurrency("EUR");
		await flush(2);
		expect(($(host, "select") as HTMLSelectElement).value).toBe("EUR");
	});
});

describe("ambient currency switch", () => {
	beforeEach(resetDom);

	it("reprices <qb-product-list> and <qb-product>, and re-reads the cart", async () => {
		// biome-ignore lint/suspicious/noDocumentCookie: planting the remembered cart id the way the cookie adapter stores it.
		document.cookie = "qb_cart_id=cart-1; path=/";
		const fake = setup([
			{ match: "GET /v2/products", body: page([sek(SIMPLE_PRODUCT)]) },
			{ match: "GET /v2/products/prod_27", body: sek(PRODUCT) },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ total: 9900 }) },
			{ match: "GET /v2/products", body: page([eur(SIMPLE_PRODUCT)]) },
			{ match: "GET /v2/products/prod_27", body: eur(PRODUCT) },
			{
				match: "GET /v2/cart/cart-1",
				body: cartEnvelope({ total: 862, currency: "EUR" }),
			},
		]);

		const host = await mount(`
			<qb-product-list>
				<template><span class="row" data-qb-text="product.priceFormatted"></span></template>
			</qb-product-list>
			<qb-product product-id="27">
				<span class="currency" data-qb-text="price.currency"></span>
			</qb-product>
			<qb-cart><span class="total" data-qb-text="cart.totalFormatted"></span></qb-cart>
		`);
		await flush(6);
		expect(text(host, ".row")).toMatch(/kr/);
		expect(text(host, ".currency")).toBe("SEK");
		expect(text(host, ".total")).toMatch(/99,00\s*kr/);

		await setCurrency("eur");
		await flush(6);

		expect(text(host, ".row")).toMatch(/€/);
		expect(text(host, ".currency")).toBe("EUR");
		expect(text(host, ".total")).toMatch(/8,62\s*€/);

		const after = fake.calls.slice(3).map((call) => sentCurrency(call.url));
		expect(after).toEqual(["EUR", "EUR", "EUR"]);
		// The same cart, re-read — no new cart was created.
		expect(fake.calls.filter((call) => call.method === "POST")).toHaveLength(0);
	});

	it("re-reads a product assigned as a property by its id", async () => {
		const fake = setup([
			{ match: "GET /v2/products/prod_27", body: eur(PRODUCT) },
		]);
		const host = await mount(
			`<qb-product><span class="currency" data-qb-text="price.currency"></span></qb-product>`,
			(root) => {
				(
					root.querySelector("qb-product") as HTMLElement & {
						product: Product;
					}
				).product = { ...PRODUCT, currency: "SEK" };
			},
		);
		await flush(3);
		expect(text(host, ".currency")).toBe("SEK");
		expect(fake.calls).toHaveLength(0);

		await setCurrency("EUR");
		await flush(4);
		expect(text(host, ".currency")).toBe("EUR");
		expect(sentCurrency(fake.calls[0]?.url ?? "")).toBe("EUR");
	});

	it("sends data-currency / configure({ currency }) on the first read", async () => {
		const fake = setup(
			[{ match: "GET /v2/products", body: page([PRODUCT]) }],
			"NOK",
		);
		await mount(
			`<qb-product-list><template><i></i></template></qb-product-list>`,
		);
		await flush(4);
		expect(sentCurrency(fake.calls[0]?.url ?? "")).toBe("NOK");
	});
});

describe("<qb-shop currency>", () => {
	beforeEach(resetDom);

	it("switches its own client on an attribute change, keeping the cart store", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT]) },
			{ match: "GET /v2/products", body: page([eur(PRODUCT)]) },
		]);
		const client = makeClient(fake.fetch);
		const host = await mount(
			`<qb-shop currency="SEK" consent="false"><qb-product-list><template><i></i></template></qb-product-list></qb-shop>`,
			(root) => {
				(
					root.querySelector("qb-shop") as HTMLElement & {
						client: typeof client;
					}
				).client = client;
			},
		);
		await flush(4);
		const shop = $(host, "qb-shop") as HTMLElement & {
			cartStore: unknown;
		};
		const store = shop.cartStore;

		shop.setAttribute("currency", "EUR");
		await flush(4);
		expect(client.currency).toBe("EUR");
		expect(shop.cartStore).toBe(store);
		expect(sentCurrency(fake.calls[1]?.url ?? "")).toBe("EUR");
		// One refetch, not one per notification path.
		expect(fake.calls).toHaveLength(2);
	});
});
