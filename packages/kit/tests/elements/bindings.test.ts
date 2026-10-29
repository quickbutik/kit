import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePath } from "../../src/elements/bindings.js";
import { configure, defineElements } from "../../src/elements/index.js";
import { ShopkitConfigError } from "../../src/sdk/errors.js";
import { createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	ensureDefined,
	flush,
	mount,
	mountWithProduct,
	PRODUCT,
	resetDom,
	text,
} from "./helpers.js";

ensureDefined();

function configureShop() {
	return configure({
		// Consent and analytics are on by default; this suite tests the
		// elements without them (they have their own suites).
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: createFakeFetch([]).fetch,
		currency: "SEK",
		locale: "sv-SE",
		maxRetries: 0,
	});
}

describe("resolvePath", () => {
	it("walks dots and array indices", () => {
		const scope = { product: { images: [{ url: "a.jpg" }] } };
		expect(resolvePath(scope, "product.images.0.url")).toBe("a.jpg");
	});

	it("returns undefined rather than throwing on a missing branch", () => {
		// A template written for a product with images must not break the page on
		// the one product that has none.
		expect(resolvePath({}, "product.images.0.url")).toBeUndefined();
		expect(resolvePath({ product: null }, "product.name")).toBeUndefined();
	});

	it("does not evaluate anything", () => {
		// The path is a path. There is no expression language, so a template
		// cannot reach a method, let alone call one.
		const scope = { product: { name: "x" } };
		expect(resolvePath(scope, "product.name.toUpperCase()")).toBeUndefined();
	});
});

describe("directives", () => {
	beforeEach(resetDom);

	it("applies text, html, attr, class, show and hide", async () => {
		configureShop();
		const host = await mountWithProduct(
			`
			<qb-product>
				<h1 id="t" data-qb-text="product.name"></h1>
				<div id="h" data-qb-html="product.description"></div>
				<a id="a" data-qb-attr="href:product.slug, title:product.name"></a>
				<span id="c" data-qb-class="on-sale:price.onSale, ranged:price.isRange"></span>
				<span id="s" data-qb-show="hasOptions">picker</span>
				<span id="x" data-qb-hide="hasOptions">simple</span>
			</qb-product>
		`,
			PRODUCT,
		);

		expect(text(host, "#t")).toBe("Complex Product");
		expect($(host, "#h").innerHTML).toBe("<strong>Nice</strong> tee");
		expect($(host, "#a").getAttribute("href")).toBe("complex-product");
		expect($(host, "#a").getAttribute("title")).toBe("Complex Product");
		expect($(host, "#c").classList.contains("ranged")).toBe(true);
		expect($(host, "#c").classList.contains("on-sale")).toBe(false);
		expect($(host, "#s").hidden).toBe(false);
		expect($(host, "#x").hidden).toBe(true);
	});

	it("removes an attribute whose value is null or false", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product><img id="i" alt="" data-qb-attr="src:product.image.url, hidden:variant.soldOut"></qb-product>`,
			{ ...PRODUCT, images: [] },
		);

		expect($(host, "#i").hasAttribute("src")).toBe(false);
		expect($(host, "#i").hasAttribute("hidden")).toBe(false);
	});

	it("does not fight an input for the caret", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product><input id="n" data-qb-value="product.name"></qb-product>`,
			PRODUCT,
		);
		const input = $(host, "#n") as HTMLInputElement;
		expect(input.value).toBe("Complex Product");

		// A re-render with an unchanged value must not reassign `value`, which
		// would move the caret to the end mid-word.
		let writes = 0;
		Object.defineProperty(input, "value", {
			get: () => "Complex Product",
			set: () => {
				writes++;
			},
			configurable: true,
		});
		$(host, "qb-product").setAttribute("currency", "SEK");
		await flush();
		expect(writes).toBe(0);
	});

	it("never binds inside a <template>", async () => {
		configureShop();
		const host = await mountWithProduct(
			`
			<qb-product>
				<qb-options>
					<template><b data-qb-text="group.name"></b></template>
				</qb-options>
			</qb-product>
		`,
			PRODUCT,
		);

		// The blueprint stays a blueprint: writing this row's value into it would
		// leak into every future clone.
		const template = $(host, "template") as HTMLTemplateElement;
		expect(template.content.querySelector("b")?.textContent).toBe("");
		expect($$(host, "b").map((b) => b.textContent)).toEqual(["Color", "Size"]);
	});
});

describe("the ambient shop", () => {
	beforeEach(resetDom);

	it("serves every element with no <qb-shop> anywhere in the document", async () => {
		configureShop();
		const host = await mount("<qb-cart-count></qb-cart-count>");

		expect(document.querySelector("qb-shop")).toBeNull();
		expect($(host, "qb-cart-count").textContent).toBe("0");
	});

	it("lets a <qb-shop> override it for its own subtree", async () => {
		const ambient = configureShop();
		const host = await mount(`
			<qb-cart-count id="outside"></qb-cart-count>
			<qb-shop consent="false" publishable-key="qb_pk_other1_abcdef0123456789abcdef0123456789"
			         api-url="https://other.test">
				<qb-cart-count id="inside"></qb-cart-count>
			</qb-shop>
		`);
		await flush();

		const scoped = $(host, "qb-shop") as HTMLElement & {
			cartStore: unknown;
		};
		expect(scoped.cartStore).toBeTruthy();
		expect(scoped.cartStore).not.toBe(ambient.cartStore);
		expect($(host, "#outside").textContent).toBe("0");
		expect($(host, "#inside").textContent).toBe("0");
	});

	it("names both fixes when nothing is configured at all", async () => {
		const errors = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let thrown: unknown;
		try {
			const element = document.createElement("qb-cart-count");
			document.body.append(element);
			await flush();
		} catch (error) {
			thrown = error;
		}
		// The element reports rather than throwing out of a callback; either way
		// the message has to say what to do.
		const message =
			(thrown as Error | undefined)?.message ??
			String(errors.mock.calls.flat().join(" "));
		expect(message).toMatch(/data-publishable-key/);
		expect(message).toMatch(/configure\(/);
		expect(message).toMatch(/<qb-shop/);
		errors.mockRestore();
	});
});

describe("defineElements", () => {
	beforeEach(resetDom);

	it("is idempotent", () => {
		// Called once at module load already; a second call must not throw the
		// NotSupportedError `customElements.define` would.
		expect(() => defineElements()).not.toThrow();
		expect(() => defineElements()).not.toThrow();
	});

	it("reports the tags it registered", () => {
		const { prefix, tags } = defineElements();
		expect(prefix).toBe("qb-");
		expect(tags.product).toBe("qb-product");
		expect(tags["option-values"]).toBe("qb-option-values");
	});
});

describe("configure", () => {
	beforeEach(resetDom);

	it("rejects a malformed key at configure time, not at first click", () => {
		expect(() => configure({ publishableKey: "nope" })).toThrow(
			ShopkitConfigError,
		);
	});
});
