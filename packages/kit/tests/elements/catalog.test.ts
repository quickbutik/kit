import { beforeEach, describe, expect, it } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { Product } from "../../src/sdk/types/catalog.js";
import { createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	ensureDefined,
	flush,
	mount,
	mountWithProduct,
	nth,
	PRODUCT,
	resetDom,
	text,
} from "./helpers.js";

ensureDefined();

function page(products: Product[]) {
	return {
		data: products,
		has_more: false,
		next_cursor: null,
	};
}

const SECOND: Product = {
	...PRODUCT,
	id: "prod_28",
	name: "Second Product",
	slug: "second-product",
	price: 14900,
};

describe("<qb-product-list>", () => {
	beforeEach(resetDom);

	it("renders one row per product with a link and a formatted price", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT, SECOND]) },
		]);
		configure({
			// Consent and analytics are on by default; this suite tests the
			// elements without them (they have their own suites).
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			currency: "SEK",
			locale: "sv-SE",
			maxRetries: 0,
		});

		const host = await mount(`
			<qb-product-list limit="12">
				<template>
					<a class="card" data-qb-attr="href:product.href">
						<h3 data-qb-text="product.name"></h3>
						<span class="price" data-qb-text="product.priceFormatted"></span>
					</a>
				</template>
			</qb-product-list>
		`);
		await flush(4);

		expect($$(host, ".card")).toHaveLength(2);
		expect(text(nth(host, ".card", 0), "h3")).toBe("Complex Product");
		expect(nth(host, ".card", 0).getAttribute("href")).toBe(
			"/products/complex-product",
		);
		expect(text(nth(host, ".card", 1), ".price")).toMatch(/149,00/);
	});

	it("honours an href-template", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT]) },
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount(`
			<qb-product-list href-template="/shop/:id">
				<template><a data-qb-attr="href:product.href"></a></template>
			</qb-product-list>
		`);
		await flush(4);

		expect($(host, "a").getAttribute("href")).toBe("/shop/prod_27");
	});

	it("uses the search endpoint only when a filter asks for it", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body: page([SECOND]) },
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount(`
			<qb-product-list search="second">
				<template><h3 data-qb-text="product.name"></h3></template>
			</qb-product-list>
		`);
		await flush(4);

		expect(fake.calls[0]?.url).toContain("/v2/products/search");
		expect(text(host, "h3")).toBe("Second Product");
	});

	it("marks itself empty when the catalog returns nothing", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([]) },
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount(`
			<qb-product-list>
				<p id="none" data-qb-show="list.empty">Inga produkter.</p>
				<template><h3 data-qb-text="product.name"></h3></template>
			</qb-product-list>
		`);
		await flush(4);

		expect($(host, "qb-product-list").hasAttribute("empty")).toBe(true);
		expect($(host, "#none").hidden).toBe(false);
	});
});

describe("<qb-product-image>", () => {
	beforeEach(resetDom);

	it("renders one <img> with the resolved URL, not the bare filename", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`<qb-product><qb-product-image width="800" height="800"></qb-product-image></qb-product>`,
			PRODUCT,
		);

		const img = $(host, "img") as HTMLImageElement;
		// `image.path` is "tee.jpeg" — a filename, not a URL. Rendering it is the
		// single most common way a headless shop ships broken images.
		expect(img.getAttribute("src")).toContain(
			"cdn.quickbutik.com/images/shop123/products/tee.jpeg",
		);
		expect(img.getAttribute("src")).toContain("w=800");
		expect(img.getAttribute("alt")).toBe("A tee");
		expect(img.getAttribute("width")).toBe("800");
		expect(img.getAttribute("srcset")).toContain(" 2x");
	});

	it("reuses the same <img> across a re-render", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`<qb-product><qb-product-image width="400"></qb-product-image></qb-product>`,
			PRODUCT,
		);
		const first = $(host, "img");

		$(host, "qb-product-image").setAttribute("width", "800");
		await flush();

		// Recreating it would restart the download and flash the image white on
		// every variant change.
		expect($(host, "img")).toBe(first);
		expect(first.getAttribute("src")).toContain("w=800");
	});

	it("renders nothing, and marks itself empty, for a product with no image", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`<qb-product><qb-product-image width="400"></qb-product-image></qb-product>`,
			{ ...PRODUCT, images: [] },
		);

		expect(host.querySelector("img")).toBeNull();
		expect($(host, "qb-product-image").hasAttribute("empty")).toBe(true);
	});
});

describe("<qb-seo>", () => {
	beforeEach(resetDom);

	it("writes the title, canonical and product structured data into <head>", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			currency: "SEK",
			maxRetries: 0,
		});
		await mountWithProduct(
			`
			<qb-product>
				<qb-seo base-url="https://minbutik.se" product-path="/produkter/{slug}"></qb-seo>
			</qb-product>
		`,
			PRODUCT,
		);
		await flush();

		expect(document.title).toContain("Complex Product");

		const canonical = document.head.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			"https://minbutik.se/produkter/complex-product",
		);

		const ogTitle = document.head.querySelector('meta[property="og:title"]');
		expect(ogTitle?.getAttribute("content")).toContain("Complex Product");

		const jsonLd = document.head.querySelector(
			'script[type="application/ld+json"]',
		);
		const parsed = JSON.parse(jsonLd?.textContent ?? "{}");
		expect(parsed["@type"]).toBe("Product");
	});

	it("removes its own tags on update, leaving nothing stale behind", async () => {
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			maxRetries: 0,
		});
		const host = await mountWithProduct(
			`<qb-product><qb-seo base-url="https://minbutik.se"></qb-seo></qb-product>`,
			PRODUCT,
		);
		await flush();
		const before = document.head.querySelectorAll("[data-qb-seo]").length;
		expect(before).toBeGreaterThan(0);

		$(host, "qb-seo").setAttribute("title", "Something else");
		await flush();

		expect(document.head.querySelectorAll("[data-qb-seo]").length).toBe(before);
		expect(document.title).toContain("Something else");
	});

	it("touches nothing in <head> that it did not write", async () => {
		const theirs = document.createElement("meta");
		theirs.setAttribute("name", "viewport");
		theirs.setAttribute("content", "width=device-width");
		document.head.append(theirs);

		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: createFakeFetch([]).fetch,
			maxRetries: 0,
		});
		await mountWithProduct(
			`<qb-product><qb-seo base-url="https://minbutik.se"></qb-seo></qb-product>`,
			PRODUCT,
		);
		await flush();

		expect(document.head.querySelector('meta[name="viewport"]')).toBe(theirs);
		theirs.remove();
	});
});
