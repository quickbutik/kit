import { linePropertiesKey } from "../sdk/line-properties.js";
import type { Cart, CartItem } from "../sdk/types/cart.js";
import type { Product, ProductVariant } from "../sdk/types/catalog.js";
import type {
	CheckoutCartProduct,
	CheckoutOrderTotal,
	CheckoutSessionSnapshot,
} from "../sdk/types/checkout.js";
import type { CurrencyCode } from "../sdk/types/common.js";
import { toMajorUnits } from "../seo/money.js";

/**
 * GA4 event names, the same ones `<Checkout onEvent>` emits. Any other
 * string is allowed for a storefront's own events.
 */
export type CommerceEventName =
	| "page_view"
	| "view_item"
	| "view_item_list"
	| "select_item"
	| "search"
	| "add_to_cart"
	| "remove_from_cart"
	| "view_cart"
	| "begin_checkout"
	| "add_shipping_info"
	| "add_payment_info"
	| "purchase"
	| (string & {});

/**
 * A GA4 item. `item_id` is the bare numeric product id, never the variant's,
 * so it matches the Google Shopping feed; the variant goes in
 * `item_variant`. Prices are in major units.
 */
export interface CommerceItem {
	item_id: string;
	item_name?: string;
	item_variant?: string;
	item_category?: string;
	/** Unit price in major units (`99`, not `9900`). */
	price?: number;
	quantity?: number;
	[key: string]: unknown;
}

export interface CommerceEventParams {
	currency?: string;
	/** Major units. */
	value?: number;
	items?: CommerceItem[];
	[key: string]: unknown;
}

export interface CommerceEvent {
	name: CommerceEventName;
	params: CommerceEventParams;
}

/** The order a thank-you page reports, in major units. */
export interface PurchaseEvent {
	/** The order number. */
	transaction_id: string;
	value: number;
	currency: string;
	tax?: number;
	shipping?: number;
	items: CommerceItem[];
	/** GA4 `affiliation` — the store the order was placed with. */
	affiliation?: string;
}

/** `"prod_27"` → `"27"`; a number passes through as its string. */
export function bareProductId(id: string | number): string {
	const text = String(id).trim();
	const match = /^prod_(.+)$/i.exec(text);
	return match?.[1] ?? text;
}

/**
 * One GA4 item for a product (and the variant the shopper is looking at, when
 * there is one). The price is the variant's when known, else the product's.
 */
export function itemFromProduct(
	product: Pick<Product, "id" | "name" | "price">,
	variant: Pick<ProductVariant, "id" | "options" | "price"> | null | undefined,
	currency?: CurrencyCode | null,
	quantity = 1,
): CommerceItem {
	const minor = variant?.price.price ?? product.price;
	const variantName = variant ? variantLabel(variant) : null;
	return compactItem({
		item_id: bareProductId(product.id),
		item_name: product.name ?? undefined,
		item_variant: variantName ?? undefined,
		price: minor == null ? undefined : toMajorUnits(minor, currency),
		quantity,
	});
}

/** The cart's lines as GA4 items. */
export function itemsFromCart(cart: Cart | null | undefined): CommerceItem[] {
	if (!cart) return [];
	return cart.items.map((line) => itemFromCartLine(line, cart.currency));
}

export function itemFromCartLine(
	line: CartItem,
	currency: CurrencyCode,
	quantity: number = line.quantity,
): CommerceItem {
	return compactItem({
		item_id: String(line.productId),
		item_name: line.productTitle ?? undefined,
		item_variant: line.variantName ?? undefined,
		price: toMajorUnits(line.unitPrice, currency),
		quantity,
	});
}

/** A checkout session's snapshotted lines (`data.cart_products`) as GA4 items. */
export function itemsFromCheckoutProducts(
	products: ReadonlyArray<CheckoutCartProduct> | null | undefined,
	currency: CurrencyCode,
): CommerceItem[] {
	if (!products) return [];
	return products.map((product) =>
		compactItem({
			item_id: String(product.productId),
			item_name: product.name,
			item_variant: product.variantName ?? undefined,
			price: toMajorUnits(product.price, currency),
			quantity: product.quantity,
		}),
	);
}

export function viewItemEvent(
	product: Pick<Product, "id" | "name" | "price">,
	variant: Pick<ProductVariant, "id" | "options" | "price"> | null | undefined,
	currency?: CurrencyCode | null,
): CommerceEvent {
	const item = itemFromProduct(product, variant, currency, 1);
	return {
		name: "view_item",
		params: compactParams({
			currency: currency ?? undefined,
			value: item.price,
			items: [item],
		}),
	};
}

export function searchEvent(term: string): CommerceEvent {
	return { name: "search", params: { search_term: term } };
}

export function viewItemListEvent(
	items: CommerceItem[],
	listName?: string,
): CommerceEvent {
	return {
		name: "view_item_list",
		params: compactParams({ item_list_name: listName, items }),
	};
}

export interface CartLineDiff {
	added: CommerceItem[];
	removed: CommerceItem[];
	currency?: string;
}

/**
 * The items added and removed between two carts, each with the quantity that
 * changed rather than the line's total. `after: null` yields every line as
 * removed.
 */
export function cartLineDiff(
	before: Cart | null | undefined,
	after: Cart | null | undefined,
): CartLineDiff {
	const currency = after?.currency ?? before?.currency;
	const previous = new Map<string, CartItem>();
	for (const line of before?.items ?? []) previous.set(lineKey(line), line);
	const next = new Map<string, CartItem>();
	for (const line of after?.items ?? []) next.set(lineKey(line), line);

	const added: CommerceItem[] = [];
	const removed: CommerceItem[] = [];
	const keys = new Set([...previous.keys(), ...next.keys()]);
	for (const key of keys) {
		const was = previous.get(key);
		const is = next.get(key);
		const delta = (is?.quantity ?? 0) - (was?.quantity ?? 0);
		const line = is ?? was;
		if (!line || delta === 0 || !currency) continue;
		if (delta > 0) added.push(itemFromCartLine(line, currency, delta));
		else removed.push(itemFromCartLine(line, currency, -delta));
	}
	return { added, removed, currency };
}

/** `{ currency, value, items }` for a set of items — the shape of every cart event. */
export function itemsParams(
	items: CommerceItem[],
	currency?: string,
): CommerceEventParams {
	const value = items.reduce(
		(sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
		0,
	);
	// Trim float artefacts (`29.9 + 10.1` → `40`, not `40.00000000000001`).
	return compactParams({ currency, value: Number(value.toFixed(2)), items });
}

/**
 * The purchase a thank-you page reports, built from the checkout session's
 * lines and total. Null when the session carries neither; the page then
 * builds the purchase itself and calls `trackPurchase`.
 */
export function purchaseFromSession(
	snapshot: Pick<CheckoutSessionSnapshot, "data"> | null | undefined,
	orderNumber: string | number,
	options: { affiliation?: string | null } = {},
): PurchaseEvent | null {
	const products = snapshot?.data?.cart_products?.value as
		| CheckoutCartProduct[]
		| undefined;
	const total = snapshot?.data?.order_total?.value as
		| CheckoutOrderTotal
		| undefined;
	if (!Array.isArray(products) || !total || typeof total.total !== "number") {
		return null;
	}
	const currency = total.currency;
	return {
		transaction_id: String(orderNumber),
		value: toMajorUnits(total.total, currency),
		currency,
		tax: toMajorUnits(total.totalTax ?? 0, currency),
		shipping: toMajorUnits(total.totalShipping ?? 0, currency),
		items: itemsFromCheckoutProducts(products, currency),
		...(options.affiliation ? { affiliation: options.affiliation } : {}),
	};
}

/** A purchase as the generic event every destination's `track` can take. */
export function purchaseToEvent(purchase: PurchaseEvent): CommerceEvent {
	return {
		name: "purchase",
		params: compactParams({
			transaction_id: purchase.transaction_id,
			affiliation: purchase.affiliation,
			currency: purchase.currency,
			value: purchase.value,
			tax: purchase.tax,
			shipping: purchase.shipping,
			items: purchase.items,
		}),
	};
}

/** `purchase_{storeId}_{orderNumber}` — the platform's Meta eventID for an order. */
export function purchaseEventId(
	storeId: string | number,
	orderNumber: string | number,
): string {
	return `purchase_${storeId}_${orderNumber}`;
}

/**
 * `qb_purchase_tracked_{storeId}_{orderNumber}`: the localStorage key the
 * hosted storefront and checkout also write, so no surface reports an order
 * twice in one browser.
 */
export function purchaseDedupKey(
	storeId: string | number,
	orderNumber: string | number,
): string {
	return `qb_purchase_tracked_${storeId}_${orderNumber}`;
}

/** Includes line properties: the same variant with different input is a separate line. */
function lineKey(line: CartItem): string {
	return `${line.productId}:${line.variantId ?? ""}:${linePropertiesKey(line.properties)}`;
}

/** "Red / XL" from the variant's option values, the way the cart names it. */
function variantLabel(variant: Pick<ProductVariant, "options">): string | null {
	const names = variant.options
		.map((option) => option.name)
		.filter((name): name is string => typeof name === "string" && name !== "");
	return names.length > 0 ? names.join(" / ") : null;
}

function compactItem(item: CommerceItem): CommerceItem {
	return compactParams(item) as CommerceItem;
}

function compactParams<T extends Record<string, unknown>>(params: T): T {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) out[key] = value;
	}
	return out as T;
}
