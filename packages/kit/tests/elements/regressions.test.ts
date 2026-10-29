import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure } from "../../src/elements/index.js";
import { QbShopElement } from "../../src/elements/shop.js";
import type { Cart } from "../../src/sdk/types/cart.js";
import type { Product } from "../../src/sdk/types/catalog.js";
import type { ProductController } from "../../src/state/product-controller.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	ensureDefined,
	flush,
	mount,
	mountWithProduct,
	PRODUCT,
	resetDom,
	SIMPLE_PRODUCT,
	text,
} from "./helpers.js";

ensureDefined();

type ProductEl = HTMLElement & {
	product: Product | null;
	selection: ProductController | null;
	addToCart(quantity?: number): Promise<Cart | null>;
};

function configureShop(fetchImpl = createFakeFetch([]).fetch) {
	return configure({
		// Consent and analytics are on by default; this suite tests the
		// elements without them (they have their own suites).
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		currency: "SEK",
		locale: "sv-SE",
		maxRetries: 0,
	});
}

describe("moving an element in the DOM", () => {
	beforeEach(resetDom);

	it("keeps <qb-product> live after it is re-parented", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<div id="a"><qb-product><span id="sku" data-qb-text="variant.sku"></span></qb-product></div>
			 <div id="b"></div>`,
			PRODUCT,
		);
		const product = $(host, "qb-product") as ProductEl;
		product.selection?.selectVariant(5);
		await flush();
		expect(text(host, "#sku")).toBe("Red-L");

		// A move is a disconnect followed by a connect. The selection should
		// survive it — and, more importantly, the element must still be listening.
		$(host, "#b").append(product);
		await flush();

		product.selection?.selectVariant(6);
		await flush();
		expect(text(host, "#sku")).toBe("Red-XL");
	});
});

describe("subscription bookkeeping", () => {
	beforeEach(resetDom);

	it("does not accumulate cleanups as the selection changes", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product>
				<qb-options>
					<template>
						<qb-option-values>
							<template><button class="v" data-qb-action="select" data-qb-text="value.name"></button></template>
						</qb-option-values>
					</template>
				</qb-options>
				<qb-add-to-cart><button>Köp</button></qb-add-to-cart>
			</qb-product>`,
			PRODUCT,
		);

		// A subscribed context provider hands out a fresh unsubscribe on every
		// re-delivery. Keeping them all would grow this array once per click for
		// as long as the page is open.
		const counted = (selector: string) =>
			($(host, selector) as unknown as { cleanups: unknown[] }).cleanups.length;
		const before = {
			add: counted("qb-add-to-cart"),
			options: counted("qb-options"),
		};

		for (let i = 0; i < 10; i++) {
			const values = $$(host, ".v");
			values[i % values.length]?.click();
			await flush(1);
		}

		expect(counted("qb-add-to-cart")).toBe(before.add);
		expect(counted("qb-options")).toBe(before.options);
	});
});

describe("<qb-shop> as an explicit override", () => {
	beforeEach(resetDom);

	it("keeps the cart handed to it before it was inserted", async () => {
		const fake = createFakeFetch([]);
		configureShop(fake.fetch);

		const element = new QbShopElement();
		element.client = configureShop(fake.fetch).client;
		const cart = cartEnvelope({ itemCount: 2 }).data as unknown as Cart;
		element.initialCart = cart;

		const store = element.cartStore;
		expect(store?.getSnapshot().itemCount).toBe(2);

		document.body.append(element);
		await flush();

		// `start()` re-runs `build()`, which must not throw away the store the
		// page already has a reference to — nor the cart it was given.
		expect(element.cartStore).toBe(store);
		expect(element.cartStore?.getSnapshot().itemCount).toBe(2);
	});

	it("hands its subtree back to the ambient shop if its key is removed", async () => {
		const ambient = configureShop();
		const host = await mount(`
			<qb-shop consent="false" publishable-key="qb_pk_other1_abcdef0123456789abcdef0123456789"
			         api-url="https://other.test">
				<qb-cart-count></qb-cart-count>
			</qb-shop>
		`);
		await flush();
		const scoped = $(host, "qb-shop") as QbShopElement;
		expect(scoped.cartStore).not.toBe(ambient.cartStore);

		scoped.removeAttribute("publishable-key");
		await flush();

		// Declining the context request would have left the badge subscribed to
		// the client the element no longer has.
		expect(scoped.cartStore).toBeNull();
	});
});

describe("<qb-add-to-cart> quantity", () => {
	beforeEach(resetDom);

	it("honours the quantity attribute", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product><qb-add-to-cart quantity="3"><button id="buy">Köp</button></qb-add-to-cart></qb-product>`,
			SIMPLE_PRODUCT,
		);
		const product = $(host, "qb-product") as ProductEl;
		const added: Array<number | undefined> = [];
		product.addToCart = async (quantity) => {
			added.push(quantity);
			return null;
		};

		$(host, "#buy").click();
		await flush();

		expect(added).toEqual([3]);
	});

	it("lets a quantity input win over the attribute", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product>
				<qb-add-to-cart quantity="3">
					<input data-qb-quantity-input value="7">
					<button id="buy">Köp</button>
				</qb-add-to-cart>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);
		const product = $(host, "qb-product") as ProductEl;
		const added: Array<number | undefined> = [];
		product.addToCart = async (quantity) => {
			added.push(quantity);
			return null;
		};

		$(host, "#buy").click();
		await flush();

		expect(added).toEqual([7]);
	});

	it("adds once, not twice, when an ancestor also carries the action", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product>
				<div data-qb-action="add-to-cart">
					<qb-add-to-cart><button id="buy">Köp</button></qb-add-to-cart>
				</div>
			</qb-product>`,
			SIMPLE_PRODUCT,
		);
		const product = $(host, "qb-product") as ProductEl;
		const added: Array<number | undefined> = [];
		product.addToCart = async (quantity) => {
			added.push(quantity);
			return null;
		};

		$(host, "#buy").click();
		await flush();

		expect(added).toHaveLength(1);
	});
});

describe("<qb-product> attribute changes", () => {
	beforeEach(resetDom);

	it("re-renders for currency without refetching the product", async () => {
		const page = { data: [PRODUCT], has_more: false, next_cursor: null };
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page },
			{ match: "GET /v2/products", body: page },
		]);
		configureShop(fake.fetch);
		const host = await mount(
			`<qb-product slug="complex-product"><span id="p" data-qb-text="price.display"></span></qb-product>`,
		);
		await flush(4);
		const requests = fake.calls.length;
		expect(text(host, "#p")).toMatch(/kr/);

		$(host, "qb-product").setAttribute("currency", "EUR");
		await flush();

		// A catalog walk to re-render a price in another currency would be an
		// expensive way to do nothing.
		expect(fake.calls.length).toBe(requests);
		expect(text(host, "#p")).toMatch(/€|EUR/);
	});

	it("applies a changed variant-id to the selection", async () => {
		configureShop();
		const host = await mountWithProduct(
			`<qb-product variant-id="5"><span id="sku" data-qb-text="variant.sku"></span></qb-product>`,
			PRODUCT,
		);
		expect(text(host, "#sku")).toBe("Red-L");

		$(host, "qb-product").setAttribute("variant-id", "10");
		await flush();

		expect(text(host, "#sku")).toBe("Black-XXL");
	});

	it("does not let an in-flight slug lookup overwrite an assigned product", async () => {
		let release: ((value: unknown) => void) | undefined;
		const blocked = new Promise((resolve) => {
			release = resolve;
		});
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: { data: [PRODUCT] } },
		]);
		configureShop(async (input, init) => {
			await blocked;
			return fake.fetch(input, init);
		});

		const host = await mount(
			`<qb-product slug="complex-product"><span id="n" data-qb-text="product.name"></span></qb-product>`,
		);
		const element = $(host, "qb-product") as ProductEl;
		element.product = SIMPLE_PRODUCT;
		await flush();
		expect(text(host, "#n")).toBe("Simple Product");

		release?.(undefined);
		await flush(4);

		expect(text(host, "#n")).toBe("Simple Product");
	});
});

describe("defineElements", () => {
	beforeEach(resetDom);

	it("does not stack a document listener on repeated calls", async () => {
		const { defineElements, stopActionWarnings } = await import(
			"../../src/elements/index.js"
		);
		// The rest of the suite registers with warnings off, so nothing is armed.
		stopActionWarnings();
		const added = vi.spyOn(document, "addEventListener");

		defineElements();
		defineElements();
		defineElements();

		// `define` itself is idempotent; the document listener has to be too, or
		// every call stacks another one that is never removed.
		expect(added.mock.calls.filter(([type]) => type === "click")).toHaveLength(
			1,
		);

		added.mockRestore();
		stopActionWarnings();
	});
});
