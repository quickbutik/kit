import { beforeEach, describe, expect, it } from "vitest";
import { configure } from "../../src/elements/index.js";
import type { Cart, CartItem } from "../../src/sdk/types/cart.js";
import type { CartStore } from "../../src/state/cart-store.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	at,
	ensureDefined,
	flush,
	mount,
	nth,
	PRODUCT,
	resetDom,
	text,
} from "./helpers.js";

ensureDefined();

function line(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "line-1",
		productId: 27,
		variantId: 10,
		quantity: 2,
		productTitle: "Complex Product",
		variantName: "Black / XXL",
		sku: "Black-XXL",
		imageUrl: null,
		unitPrice: 9900,
		unitPriceExclTax: 7920,
		unitPriceInclTax: 9900,
		compareAtPrice: null,
		taxRate: 25,
		taxAmount: 1980,
		discountAmount: 0,
		lineTotal: 19800,
		lineTotalTax: 3960,
		lineTotalExclTax: 15840,
		lineTotalInclTax: 19800,
		available: true,
		...overrides,
	};
}

/** The store's cart, or a named failure — the tests always have one by then. */
function requireCart(store: CartStore): Cart {
	const { cart } = store.getSnapshot();
	if (!cart) throw new Error("the store has no cart");
	return cart;
}

/** Click the option value with this label, wherever the picker put it. */
function clickValue(root: ParentNode, label: string): void {
	const button = $$(root, ".value").find(
		(candidate) => candidate.textContent === label,
	);
	if (!button) throw new Error(`no option value labelled ${label}`);
	button.click();
}

function withCart(items: CartItem[]) {
	const cart = cartEnvelope({
		items,
		itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
		subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
		total: items.reduce((sum, item) => sum + item.lineTotal, 0),
	});
	return createFakeFetch([
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
	]);
}

const CART_MARKUP = `
	<qb-cart>
		<p id="empty" data-qb-show="cart.empty">Din varukorg är tom.</p>
		<qb-cart-items>
			<template>
				<li>
					<span class="title" data-qb-text="item.productTitle"></span>
					<span class="variant" data-qb-text="item.variantName"></span>
					<input class="qty" type="number" data-qb-quantity data-qb-value="item.quantity">
					<span class="total" data-qb-text="item.lineTotalFormatted"></span>
					<button class="remove" data-qb-action="remove">Ta bort</button>
					<button class="plus" data-qb-action="increment">+</button>
				</li>
			</template>
		</qb-cart-items>
		<strong id="total" data-qb-text="cart.totalFormatted"></strong>
	</qb-cart>
`;

/** A client whose storage already remembers a cart, so `load()` fetches one. */
async function mountCart(items: CartItem[]) {
	const fake = withCart(items);
	const shop = configure({
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
	await shop.client.storage.set("qb_cart_id", "cart-1");
	const host = await mount(CART_MARKUP);
	await flush();
	return { host, fake, shop };
}

describe("<qb-cart> / <qb-cart-items>", () => {
	beforeEach(resetDom);

	it("renders one row per line, with formatted money", async () => {
		const { host } = await mountCart([line()]);

		expect($$(host, "li")).toHaveLength(1);
		expect(text(host, ".title")).toBe("Complex Product");
		expect(text(host, ".variant")).toBe("Black / XXL");
		expect(text(host, ".total")).toMatch(/198,00/);
		expect(text(host, "#total")).toMatch(/198,00/);
	});

	it("fills the quantity input from the line", async () => {
		const { host } = await mountCart([line({ quantity: 3 })]);
		expect(($(host, ".qty") as HTMLInputElement).value).toBe("3");
	});

	it("reflects empty as an attribute rather than hiding anything itself", async () => {
		const { host } = await mountCart([]);

		expect($(host, "qb-cart").hasAttribute("empty")).toBe(true);
		expect($(host, "#empty").hidden).toBe(false);
		expect($$(host, "li")).toHaveLength(0);
	});

	it("removes the line the button is in", async () => {
		const { host, fake } = await mountCart([
			line({ id: "line-1" }),
			line({ id: "line-2", productTitle: "Other" }),
		]);

		nth(nth(host, "li", 1), ".remove", 0).click();
		await flush();

		const del = fake.calls.find((call) => call.method === "DELETE");
		expect(del?.url).toContain("/v2/cart/cart-1/items/line-2");
	});

	it("increments the line the button is in", async () => {
		const { host, fake } = await mountCart([line({ quantity: 2 })]);

		$(host, ".plus").click();
		await flush();

		const patch = fake.calls.find(
			(call) => call.method === "PATCH" || call.method === "PUT",
		);
		expect(patch?.body).toMatchObject({ quantity: 3 });
	});

	it("commits a typed quantity on change, not on every keystroke", async () => {
		const { host, fake } = await mountCart([line({ quantity: 2 })]);
		const input = $(host, ".qty") as HTMLInputElement;

		input.value = "12";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(fake.calls.filter((call) => call.method !== "GET")).toHaveLength(0);

		input.dispatchEvent(new Event("change", { bubbles: true }));
		await flush();

		const write = fake.calls.find((call) => call.method !== "GET");
		expect(write?.body).toMatchObject({ quantity: 12 });
	});

	it("reuses the row element across an update, so the input keeps focus", async () => {
		const { host, shop } = await mountCart([line({ quantity: 2 })]);
		const input = $(host, ".qty") as HTMLInputElement;

		shop.cartStore.hydrate({
			...requireCart(shop.cartStore),
			items: [line({ quantity: 5 })],
			itemCount: 5,
		});
		await flush();

		// Same node, new value — a rebuilt row would drop the caret mid-edit.
		expect($(host, ".qty")).toBe(input);
		expect(input.value).toBe("5");
	});
});

describe("<qb-cart-count>", () => {
	beforeEach(resetDom);

	it("shows the item count and marks itself zero when empty", async () => {
		const fake = withCart([]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount("<qb-cart-count></qb-cart-count>");

		const badge = $(host, "qb-cart-count");
		expect(badge.textContent).toBe("0");
		expect(badge.hasAttribute("zero")).toBe(true);
	});

	it("shares one store with every other cart element on the page", async () => {
		const { host, shop } = await mountCart([line({ quantity: 2 })]);
		const badge = document.createElement("qb-cart-count");
		host.append(badge);
		await flush();

		expect(badge.textContent).toBe("2");

		shop.cartStore.hydrate({
			...requireCart(shop.cartStore),
			items: [line({ quantity: 7 })],
			itemCount: 7,
		});
		await flush();

		expect(badge.textContent).toBe("7");
		expect(($(host, ".qty") as HTMLInputElement).value).toBe("7");
	});
});

describe("<qb-add-to-cart>", () => {
	beforeEach(resetDom);

	it("refuses to add until the selection pins a variant, then adds it", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			currency: "SEK",
			maxRetries: 0,
		});

		const host = await mount(
			`
			<qb-product>
				<qb-options>
					<template>
						<qb-option-values>
							<template><button class="value" data-qb-action="select" data-qb-text="value.name"></button></template>
						</qb-option-values>
					</template>
				</qb-options>
				<qb-add-to-cart><button id="add">Lägg i varukorg</button></qb-add-to-cart>
			</qb-product>
		`,
			(root) => {
				(
					root.querySelector("qb-product") as HTMLElement & {
						product: unknown;
					}
				).product = PRODUCT;
			},
		);

		const button = $(host, "#add") as HTMLButtonElement;
		// Two option groups, nothing chosen — the button is disabled for real, not
		// merely styled as such, so a keyboard user cannot get past it either.
		expect(button.disabled).toBe(true);

		clickValue(host, "Black");
		await flush();
		clickValue(host, "XXL");
		await flush();

		expect(button.disabled).toBe(false);
		button.click();
		await flush();

		const post = fake.calls.find((call) =>
			new URL(call.url).pathname.endsWith("/items"),
		);
		expect(post?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 1,
		});
	});

	it("is immediately addable for a product with no options", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		]);
		configure({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			fetch: fake.fetch,
			maxRetries: 0,
		});
		const host = await mount(
			`<qb-product><qb-add-to-cart><button id="add">Köp</button></qb-add-to-cart></qb-product>`,
			(root) => {
				(
					root.querySelector("qb-product") as HTMLElement & {
						product: unknown;
					}
				).product = {
					...PRODUCT,
					options: [],
					variants: [{ ...at(PRODUCT.variants, 0), options: [] }],
				};
			},
		);

		expect(($(host, "#add") as HTMLButtonElement).disabled).toBe(false);
	});
});
