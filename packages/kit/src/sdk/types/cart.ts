import type { StorefrontSurface } from "../storefront.js";
import type { ProductFieldType } from "./catalog.js";
import type { CurrencyCode, MinorUnits } from "./common.js";
import type { ShopCurrencyMode } from "./shop.js";

export interface CartItem {
	/** Cart line id (uuid) — the handle for update/remove, NOT the product id. */
	id: string;
	productId: number;
	variantId?: number;
	quantity: number;
	productTitle: string | null;
	/** "Red / XL", built from the variant's option values. Null for simple products. */
	variantName: string | null;
	sku: string | null;
	imageUrl: string | null;
	/** Display unit price — incl. or excl. tax depending on the shop's setting. */
	unitPrice: MinorUnits;
	unitPriceExclTax: MinorUnits;
	unitPriceInclTax: MinorUnits;
	compareAtPrice: MinorUnits | null;
	taxRate: number;
	taxAmount: MinorUnits;
	discountAmount: MinorUnits;
	lineTotal: MinorUnits;
	lineTotalTax: MinorUnits;
	lineTotalExclTax: MinorUnits;
	lineTotalInclTax: MinorUnits;
	/** False when the product was hidden or deleted after being added. */
	available: boolean;
	/**
	 * The shopper's product-field input on this line, resolved against the
	 * product's current fields. Part of the line's identity: the same product
	 * and variant with different input is a separate line. Absent (never `[]`)
	 * on a line added without input.
	 */
	properties?: CartItemProperty[];
}

/**
 * One product-field input on a cart line, as the server resolved it.
 */
export interface CartItemProperty {
	/** The product field's id — `product.fields[n].id`. */
	propertyId: number;
	/**
	 * The input as stored: the text for a text field, `"1"` for a ticked
	 * checkbox, the original file name for a file field.
	 */
	value: string;
	/**
	 * The field's label as plain text. Null when the field no longer exists
	 * (the merchant changed the product's fields): such a line is refused at
	 * checkout until it is removed and added again.
	 */
	title: string | null;
	/** The field type; null when the field no longer exists. */
	type: ProductFieldType | null;
	/**
	 * The field's per-unit add-on, already included in the line's
	 * `unitPrice`. 0 when free or when the field no longer exists.
	 */
	price: MinorUnits;
}

/**
 * The shopper's input for one product field, sent with
 * {@link AddCartItemInput.properties}.
 */
export interface CartItemPropertyInput {
	/** The product field's id — `product.fields[n].id`. */
	propertyId: number;
	/**
	 * The text for a `shorttext` / `longtext` field, `"1"` for a ticked
	 * `checkbox`, and the ORIGINAL file name (.png, .jpg, .jpeg or .pdf) for a
	 * `file` field. Surrounding whitespace is trimmed server-side and an empty
	 * value counts as no input — leave an unticked checkbox out. A `file` field
	 * cannot be completed from a headless storefront yet; see
	 * {@link ProductField.type}.
	 */
	value: string;
}

/**
 * A server-owned cart. Prices are recomputed on every read, so a cart held in
 * a cookie for a week still reflects today's prices — never cache these
 * numbers client-side beyond the current render.
 */
export interface Cart {
	id: string;
	storeId: number;
	items: CartItem[];
	/** Sum of quantities, not of lines. */
	itemCount: number;
	/**
	 * The currency every amount in THIS response is in. A cart stores no
	 * currency of its own: it is priced per request, in the client's chosen
	 * currency when the shop offers it, so the same cart reads in SEK on one
	 * request and EUR on the next.
	 */
	currency: CurrencyCode;
	/**
	 * How this response's currency relates to the checkout. When absent, read
	 * it as `mode: "base"`.
	 */
	presentment?: CartPresentment;
	subtotal: MinorUnits;
	subtotalExclTax: MinorUnits;
	subtotalInclTax: MinorUnits;
	totalTax: MinorUnits;
	totalDiscount: MinorUnits;
	total: MinorUnits;
	totalExclTax: MinorUnits;
	totalInclTax: MinorUnits;
	createdAt: string;
	updatedAt: string;
	/**
	 * The campaign storefront this cart is bound to, or null for an ordinary
	 * cart (absent reads as null). A bound cart is priced with the campaign's
	 * overrides on every read, and a checkout session created from it inherits
	 * the binding.
	 */
	storefrontId?: string | null;
	/** Where the campaign was presented, recorded with the binding. */
	surface?: StorefrontSurface | null;
}

export interface AddCartItemInput {
	/**
	 * Either the prefixed id from `products.list()` (`"prod_123"`) or the raw
	 * numeric id.
	 */
	productId: string | number;
	/** Required for a product that has more than one variant. */
	variantId?: number;
	/** Defaults to 1. */
	quantity?: number;
	/**
	 * Product-field input for this line (see `Product.fields`). The same
	 * product and variant with different input becomes a separate line;
	 * identical input adds to the existing line. When the line carries any
	 * input, every `required` field of the product must be present, or the add
	 * is refused with a 400 naming the `propertyId`. Omit it (or pass `[]`)
	 * for a product without fields.
	 */
	properties?: CartItemPropertyInput[];
}

/** See {@link Cart.presentment}. */
export interface CartPresentment {
	/**
	 * - `"base"` — amounts are in the shop's own currency.
	 * - `"display"` — amounts are converted for display; the checkout charges
	 *   `chargeCurrency` (the shop's currency).
	 * - `"charge"` — amounts are what the checkout will charge, in `currency`.
	 */
	mode: ShopCurrencyMode;
	/** What the checkout will charge in. */
	chargeCurrency: CurrencyCode;
	/** The shop's own currency. */
	baseCurrency: CurrencyCode;
	/** Units of `currency` per 1 unit of `baseCurrency`. 1 for `"base"`. */
	exchangeRate: number;
}
