import { describe, expect, it } from "vitest";
import {
	bareProductId,
	type CommerceItem,
	cartLineDiff,
	itemFromCartLine,
	itemFromProduct,
	itemsFromCart,
	itemsFromCheckoutProducts,
	itemsParams,
	purchaseFromSession,
	purchaseToEvent,
	searchEvent,
	viewItemEvent,
	viewItemListEvent,
} from "../src/analytics/events.js";
import type { Cart, CartItem } from "../src/sdk/types/cart.js";
import type {
	CheckoutCartProduct,
	CheckoutOrderTotal,
	CheckoutSessionSnapshot,
	DataState,
} from "../src/sdk/types/checkout.js";
import { toMajorUnits } from "../src/seo/money.js";
import { PRODUCT } from "./elements/helpers.js";
import { cartEnvelope, cartLine } from "./helpers.js";

/** A cart with the given lines, in the shape the API returns. */
function cart(
	items: CartItem[],
	overrides: Record<string, unknown> = {},
): Cart {
	return cartEnvelope({
		items,
		itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
		...overrides,
	}).data as unknown as Cart;
}

const TEE_ITEM: CommerceItem = {
	item_id: "27",
	item_name: "Tee",
	price: 99,
	quantity: 1,
};

const ORDER_TOTAL: CheckoutOrderTotal = {
	subtotal: 9900,
	subtotalExclTax: 7920,
	subtotalInclTax: 9900,
	totalTax: 2580,
	totalDiscount: 0,
	totalShipping: 3000,
	totalPaymentFee: 0,
	total: 12900,
	currency: "SEK",
	lines: [],
};

const CART_PRODUCTS: CheckoutCartProduct[] = [
	{
		productId: "27",
		variantId: "10",
		name: "Tee",
		variantName: "Red / L",
		price: 9900,
		quantity: 1,
		imageUrl: null,
	},
];

function node<T>(value: T | null): DataState<T> {
	return { value, resolvedAt: "2026-10-01T10:00:00.000Z" };
}

function snapshot(
	data: Record<string, DataState>,
): Pick<CheckoutSessionSnapshot, "data"> {
	return { data };
}

describe("toMajorUnits", () => {
	it("divides by the currency's minor unit", () => {
		expect(toMajorUnits(9900, "SEK")).toBe(99);
		expect(toMajorUnits(1234, "SEK")).toBe(12.34);
		expect(toMajorUnits(1250, "EUR")).toBe(12.5);
	});

	it("leaves a zero-decimal currency alone", () => {
		expect(toMajorUnits(990, "JPY")).toBe(990);
	});

	it("assumes two decimals without a currency", () => {
		expect(toMajorUnits(1234)).toBe(12.34);
		expect(toMajorUnits(9900, null)).toBe(99);
	});
});

describe("bareProductId", () => {
	it("strips the prod_ prefix", () => {
		expect(bareProductId("prod_27")).toBe("27");
		expect(bareProductId("PROD_27")).toBe("27");
	});

	it("passes a bare id through as a string", () => {
		expect(bareProductId(27)).toBe("27");
		expect(bareProductId("27")).toBe("27");
		expect(bareProductId(" 27 ")).toBe("27");
	});
});

describe("itemFromProduct", () => {
	it("builds a GA4 item for a product and the variant on screen", () => {
		const actual = itemFromProduct(PRODUCT, PRODUCT.variants[0], "SEK");

		expect(actual).toEqual({
			item_id: "27",
			item_name: "Complex Product",
			item_variant: "Red / L",
			price: 99,
			quantity: 1,
		});
	});

	it("prices from the variant when it has its own price", () => {
		const actual = itemFromProduct(PRODUCT, PRODUCT.variants[4], "SEK");

		expect(actual.item_variant).toBe("Black / XXL");
		expect(actual.price).toBe(999);
	});

	it("uses the product price and no variant label without a variant", () => {
		const actual = itemFromProduct(PRODUCT, null, "SEK");

		expect(actual).toEqual({
			item_id: "27",
			item_name: "Complex Product",
			price: 99,
			quantity: 1,
		});
		expect(actual).not.toHaveProperty("item_variant");
	});

	it("takes a quantity", () => {
		expect(itemFromProduct(PRODUCT, null, "SEK", 3).quantity).toBe(3);
	});

	it("omits the price when the product has none", () => {
		const actual = itemFromProduct(
			{ id: "prod_1", name: "Unpriced", price: null },
			null,
			"SEK",
		);

		expect(actual).toEqual({
			item_id: "1",
			item_name: "Unpriced",
			quantity: 1,
		});
	});

	it("omits the variant label when the options carry no names", () => {
		const inputVariant = {
			id: 1,
			price: { price: 500, comparePrice: null },
			options: [{ id: 1, name: null, position: 1, optionId: 1 }],
		};

		const actual = itemFromProduct(PRODUCT, inputVariant, "SEK");

		expect(actual).not.toHaveProperty("item_variant");
		expect(actual.price).toBe(5);
	});
});

describe("itemsFromCart / itemFromCartLine", () => {
	it("is empty for no cart", () => {
		expect(itemsFromCart(null)).toEqual([]);
		expect(itemsFromCart(undefined)).toEqual([]);
	});

	it("maps every line with the product id as item_id", () => {
		const inputCart = cart([
			cartLine(),
			cartLine({
				id: "line-2",
				productId: 31,
				variantId: 12,
				productTitle: "Cap",
				variantName: "Blue",
				unitPrice: 1050,
				quantity: 2,
			}),
		]);

		expect(itemsFromCart(inputCart)).toEqual([
			TEE_ITEM,
			{
				item_id: "31",
				item_name: "Cap",
				item_variant: "Blue",
				price: 10.5,
				quantity: 2,
			},
		]);
	});

	it("lets a caller override the quantity on one line", () => {
		const actual = itemFromCartLine(cartLine({ quantity: 5 }), "SEK", 2);
		expect(actual.quantity).toBe(2);
	});
});

describe("itemsFromCheckoutProducts", () => {
	it("is empty for no products", () => {
		expect(itemsFromCheckoutProducts(null, "SEK")).toEqual([]);
		expect(itemsFromCheckoutProducts(undefined, "SEK")).toEqual([]);
	});

	it("maps the session's snapshotted lines", () => {
		const actual = itemsFromCheckoutProducts(
			[
				...CART_PRODUCTS,
				{
					productId: "31",
					name: "Cap",
					variantName: null,
					price: 1050,
					quantity: 2,
					imageUrl: null,
				},
			],
			"SEK",
		);

		expect(actual).toEqual([
			{
				item_id: "27",
				item_name: "Tee",
				item_variant: "Red / L",
				price: 99,
				quantity: 1,
			},
			{ item_id: "31", item_name: "Cap", price: 10.5, quantity: 2 },
		]);
	});
});

describe("event builders", () => {
	it("viewItemEvent carries currency, value and the one item", () => {
		const actual = viewItemEvent(PRODUCT, PRODUCT.variants[0], "SEK");

		expect(actual).toEqual({
			name: "view_item",
			params: {
				currency: "SEK",
				value: 99,
				items: [
					{
						item_id: "27",
						item_name: "Complex Product",
						item_variant: "Red / L",
						price: 99,
						quantity: 1,
					},
				],
			},
		});
	});

	it("viewItemEvent leaves out a currency it was not given", () => {
		const actual = viewItemEvent(PRODUCT, null);

		expect(actual.params).not.toHaveProperty("currency");
		expect(actual.params.value).toBe(99);
	});

	it("searchEvent carries the term", () => {
		expect(searchEvent("tee")).toEqual({
			name: "search",
			params: { search_term: "tee" },
		});
	});

	it("viewItemListEvent carries the items and an optional list name", () => {
		expect(viewItemListEvent([TEE_ITEM], "Front page")).toEqual({
			name: "view_item_list",
			params: { item_list_name: "Front page", items: [TEE_ITEM] },
		});
		expect(viewItemListEvent([TEE_ITEM]).params).not.toHaveProperty(
			"item_list_name",
		);
	});
});

describe("cartLineDiff", () => {
	it("reports a first add as an added line", () => {
		const actual = cartLineDiff(null, cart([cartLine()]));

		expect(actual).toEqual({ added: [TEE_ITEM], removed: [], currency: "SEK" });
	});

	it("reports a quantity increase as the quantity that was added", () => {
		const actual = cartLineDiff(
			cart([cartLine({ quantity: 1 })]),
			cart([cartLine({ quantity: 3 })]),
		);

		expect(actual.added).toEqual([{ ...TEE_ITEM, quantity: 2 }]);
		expect(actual.removed).toEqual([]);
	});

	it("reports a quantity decrease as the quantity that was removed", () => {
		const actual = cartLineDiff(
			cart([cartLine({ quantity: 3 })]),
			cart([cartLine({ quantity: 1 })]),
		);

		expect(actual.added).toEqual([]);
		expect(actual.removed).toEqual([{ ...TEE_ITEM, quantity: 2 }]);
	});

	it("reports a line that went away as removed", () => {
		const actual = cartLineDiff(cart([cartLine({ quantity: 2 })]), cart([]));

		expect(actual.removed).toEqual([{ ...TEE_ITEM, quantity: 2 }]);
		expect(actual.added).toEqual([]);
	});

	it("reports every line as removed when the cart is gone", () => {
		const inputBefore = cart([
			cartLine(),
			cartLine({ id: "line-2", productId: 31, variantId: 12, unitPrice: 1000 }),
		]);

		const actual = cartLineDiff(inputBefore, null);

		expect(actual.removed.map((item) => item.item_id)).toEqual(["27", "31"]);
		expect(actual.added).toEqual([]);
		expect(actual.currency).toBe("SEK");
	});

	it("keys by product and variant, not by line id, so a merged add is one more", () => {
		// The server folded the second add into the existing line and handed it
		// back under a new line id; the shopper added one, not a whole line.
		const actual = cartLineDiff(
			cart([cartLine({ id: "line-1", quantity: 1 })]),
			cart([cartLine({ id: "line-9", quantity: 2 })]),
		);

		expect(actual.added).toEqual([{ ...TEE_ITEM, quantity: 1 }]);
		expect(actual.removed).toEqual([]);
	});

	it("tells two variants of the same product apart", () => {
		const actual = cartLineDiff(
			cart([cartLine({ variantId: 10 })]),
			cart([
				cartLine({ variantId: 10 }),
				cartLine({ id: "line-2", variantId: 11, variantName: "Red / XL" }),
			]),
		);

		expect(actual.added).toEqual([{ ...TEE_ITEM, item_variant: "Red / XL" }]);
		expect(actual.removed).toEqual([]);
	});

	it("reports nothing for an unchanged cart", () => {
		const actual = cartLineDiff(cart([cartLine()]), cart([cartLine()]));
		expect(actual).toEqual({ added: [], removed: [], currency: "SEK" });
	});

	it("is empty when there is no cart on either side", () => {
		expect(cartLineDiff(null, null)).toEqual({
			added: [],
			removed: [],
			currency: undefined,
		});
	});

	it("carries item_id as the product id string", () => {
		const actual = cartLineDiff(null, cart([cartLine({ productId: 27 })]));
		expect(actual.added[0]?.item_id).toBe("27");
		expect(typeof actual.added[0]?.item_id).toBe("string");
	});
});

describe("itemsParams", () => {
	it("sums price times quantity into value", () => {
		const actual = itemsParams(
			[
				{ item_id: "27", price: 99, quantity: 2 },
				{ item_id: "31", price: 10.5, quantity: 1 },
			],
			"SEK",
		);

		expect(actual).toEqual({
			currency: "SEK",
			value: 208.5,
			items: [
				{ item_id: "27", price: 99, quantity: 2 },
				{ item_id: "31", price: 10.5, quantity: 1 },
			],
		});
	});

	it("trims the float artefact of summing major units", () => {
		const actual = itemsParams([
			{ item_id: "1", price: 29.9 },
			{ item_id: "2", price: 10.1 },
		]);

		expect(actual.value).toBe(40);
	});

	it("treats a missing price as zero and a missing quantity as one", () => {
		const actual = itemsParams([{ item_id: "1" }, { item_id: "2", price: 5 }]);
		expect(actual.value).toBe(5);
	});

	it("leaves out a currency it was not given", () => {
		expect(itemsParams([TEE_ITEM])).not.toHaveProperty("currency");
	});
});

describe("purchaseFromSession", () => {
	it("builds the purchase from cart_products and order_total", () => {
		const actual = purchaseFromSession(
			snapshot({
				cart_products: node(CART_PRODUCTS),
				order_total: node(ORDER_TOTAL),
			}),
			"1001",
		);

		expect(actual).toEqual({
			transaction_id: "1001",
			value: 129,
			currency: "SEK",
			tax: 25.8,
			shipping: 30,
			items: [
				{
					item_id: "27",
					item_name: "Tee",
					item_variant: "Red / L",
					price: 99,
					quantity: 1,
				},
			],
		});
		expect(actual).not.toHaveProperty("affiliation");
	});

	it("takes the order number as a number too", () => {
		const actual = purchaseFromSession(
			snapshot({
				cart_products: node(CART_PRODUCTS),
				order_total: node(ORDER_TOTAL),
			}),
			1001,
		);
		expect(actual?.transaction_id).toBe("1001");
	});

	it("is null when either node is missing or unresolved", () => {
		expect(
			purchaseFromSession(snapshot({ order_total: node(ORDER_TOTAL) }), "1001"),
		).toBeNull();
		expect(
			purchaseFromSession(
				snapshot({ cart_products: node(CART_PRODUCTS) }),
				"1001",
			),
		).toBeNull();
		expect(
			purchaseFromSession(
				snapshot({
					cart_products: node(CART_PRODUCTS),
					order_total: node<CheckoutOrderTotal>(null),
				}),
				"1001",
			),
		).toBeNull();
		expect(
			purchaseFromSession(
				snapshot({
					cart_products: node<CheckoutCartProduct[]>(null),
					order_total: node(ORDER_TOTAL),
				}),
				"1001",
			),
		).toBeNull();
	});

	it("is null for no snapshot at all", () => {
		expect(purchaseFromSession(null, "1001")).toBeNull();
		expect(purchaseFromSession(undefined, "1001")).toBeNull();
		expect(purchaseFromSession({ data: {} }, "1001")).toBeNull();
	});

	it("passes affiliation through, and only when given", () => {
		const inputSnapshot = snapshot({
			cart_products: node(CART_PRODUCTS),
			order_total: node(ORDER_TOTAL),
		});

		expect(
			purchaseFromSession(inputSnapshot, "1001", { affiliation: "Min butik" })
				?.affiliation,
		).toBe("Min butik");
		expect(
			purchaseFromSession(inputSnapshot, "1001", { affiliation: null }),
		).not.toHaveProperty("affiliation");
	});

	it("treats missing tax and shipping totals as zero", () => {
		const {
			totalTax: _tax,
			totalShipping: _shipping,
			...partial
		} = ORDER_TOTAL;

		const actual = purchaseFromSession(
			snapshot({
				cart_products: node(CART_PRODUCTS),
				order_total: node(partial as CheckoutOrderTotal),
			}),
			"1001",
		);

		expect(actual?.tax).toBe(0);
		expect(actual?.shipping).toBe(0);
	});
});

describe("purchaseToEvent", () => {
	it("is a purchase event with the GA4 parameters", () => {
		const actual = purchaseToEvent({
			transaction_id: "1001",
			value: 129,
			currency: "SEK",
			tax: 25.8,
			shipping: 30,
			items: [TEE_ITEM],
			affiliation: "Min butik",
		});

		expect(actual).toEqual({
			name: "purchase",
			params: {
				transaction_id: "1001",
				affiliation: "Min butik",
				currency: "SEK",
				value: 129,
				tax: 25.8,
				shipping: 30,
				items: [TEE_ITEM],
			},
		});
	});

	it("leaves out the optional parameters it was not given", () => {
		const actual = purchaseToEvent({
			transaction_id: "1001",
			value: 129,
			currency: "SEK",
			items: [TEE_ITEM],
		});

		expect(actual.params).toEqual({
			transaction_id: "1001",
			currency: "SEK",
			value: 129,
			items: [TEE_ITEM],
		});
	});
});
