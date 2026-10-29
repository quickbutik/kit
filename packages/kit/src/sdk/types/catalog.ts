import type { CurrencyCode, MinorUnits } from "./common.js";

export interface ProductImage {
	id: number;
	productId: number;
	/**
	 * Absolute URL of the image file, with **no** resize parameters. Add them
	 * yourself (`?w=&h=`, imgix-compatible) or let `resolveProductImageUrl` /
	 * `<ProductImage />` do it. Null when the image has no file yet.
	 */
	url: string | null;
	/** The bare storage filename (`5c7b0e7e1802c.jpeg`). **Not** a URL; use `url`. */
	path: string | null;
	position: number | null;
	date: string | null;
	altText: string | null;
	/**
	 * Hash of the binary, appended as a cache-buster by
	 * `resolveProductImageUrl`. The literal `"temp"` marks an image whose file
	 * is still being processed.
	 */
	contentHash: string | null;
}

/** A selectable option ("Size"), owned by the product. */
export interface ProductOptionType {
	id: number;
	name: string | null;
	position: number | null;
}

/** One concrete choice of an option ("XL"), referenced by a variant. */
export interface ProductOptionValue {
	id: number;
	name: string | null;
	position: number | null;
	optionId: number | null;
}

/**
 * Where a price came from. `customer_group` is a logged-in customer's group
 * price, `campaign` a campaign storefront's override.
 */
export type PriceSource = "base" | "sale" | "customer_group" | "campaign";

export interface ProductVariantPrice {
	/** Null when the shop hides prices from guests (`hidden: true`). */
	price: MinorUnits | null;
	/** "Before" price, for a struck-through comparison. Null when not on sale. */
	comparePrice: MinorUnits | null;
	/** Where `price` came from. */
	source?: PriceSource;
	/**
	 * True when the shop shows prices to logged-in customers only and this
	 * shopper is a guest: the amounts are null. Show a "log in to see prices"
	 * hint instead.
	 */
	hidden?: boolean;
}

/**
 * Who a catalog response was priced for: `page.meta.pricing` on a product
 * list or search, `product.pricing` on a single product read.
 */
export interface CatalogPricing {
	/** `anonymous` = a guest; `customer_group` = priced with the group's prices. */
	audience: "anonymous" | "customer" | "customer_group";
	/** The customer's group, when `audience` is `customer_group`. */
	groupId: number | null;
	/**
	 * How the customer's group shows prices, or null outside a group. A
	 * display hint only: amounts are the same either way.
	 */
	vatDisplay: "incl" | "excl" | null;
}

export interface ProductVariantStock {
	stock: number | null;
	preorder: boolean | null;
}

export interface ProductVariant {
	/** Numeric — this is the id the Cart API takes as `variantId`. */
	id: number;
	sku: string;
	barcode: string | null;
	/** Grams. */
	weight: number | null;
	hidden: boolean | null;
	minPurchaseQty: number | null;
	maxPurchaseQty: number | null;
	/**
	 * The variant's own image: the `id` of one of the product's `images`. Null
	 * when the variant has no image of its own, and always on the single
	 * synthetic variant of a simple product.
	 */
	imageId?: number | null;
	price: ProductVariantPrice;
	stock: ProductVariantStock;
	options: ProductOptionValue[];
}

/**
 * A merchant-authored content section of a product page ("Size guide",
 * "Care", "Delivery"), in the order the merchant arranged them.
 *
 * Rendered server-side exactly as the Quickbutik theme renders it: a section
 * linked to a shared template already carries the template's text, and the
 * `[STOCKLEFT]`, `[PRICE]` and `[BEFOREPRICE]` merge tags are replaced.
 */
export interface ProductSection {
	/** Stable across edits and unique within the product — a render key. */
	id: string;
	/** Heading. May be empty when the section has content only. */
	title: string;
	/**
	 * Merchant-authored **HTML**. May be empty when the section has a title
	 * only. Sanitize it before injecting it as HTML.
	 */
	content: string;
}

/** The kind of input a {@link ProductField} asks for. */
export type ProductFieldType = "shorttext" | "longtext" | "checkbox" | "file";

/**
 * A field the shopper fills in when buying the product ("produktfält"): a
 * name to engrave, a gift message, a checkbox, a file to print. Send the
 * input with `cart.add({ ..., properties: [{ propertyId: field.id, value }] })`.
 */
export interface ProductField {
	/** Pass it back as `propertyId` in `AddCartItemInput.properties`. */
	id: number;
	/**
	 * - `shorttext` — a single-line text input;
	 * - `longtext` — a multi-line text input;
	 * - `checkbox` — send `"1"` when ticked, leave it out otherwise;
	 * - `file` — cannot be completed from a headless storefront yet: only the
	 *   file name is stored, not the file. Treat a product with a `required`
	 *   file field as not purchasable here, and leave optional ones out.
	 */
	type: ProductFieldType;
	/** The field's label, as plain text. */
	title: string;
	/** True when an add carrying any input must include this field. */
	required: boolean;
	/**
	 * Per-unit add-on when the field is filled in, in the product's currency
	 * and VAT basis; 0 when free. `null` when the shop hides prices from
	 * guests, like the product's own price.
	 */
	price: MinorUnits | null;
}

/**
 * How the merchant chose a product's related products:
 * - `category` — products from the same category (the default);
 * - `specific` — a hand-picked list, in the merchant's order;
 * - `none` — switched off for this product, or not used by the shop.
 */
export type RelatedProductsMode = "category" | "specific" | "none";

/** A related product, reduced to what a product card needs. */
export interface RelatedProductSummary {
	/** Prefixed id (`prod_123`) — pass it to `products.get` or `cart.addItem`. */
	id: string;
	name: string | null;
	slug: string | null;
	/**
	 * The product's own price, priced like the product list (automatic
	 * discounts and `storefrontId` campaign prices included).
	 */
	price: ProductVariantPrice;
	/** The product's first image, or null when it has none. */
	image: ProductImage | null;
}

export interface RelatedProducts {
	mode: RelatedProductsMode;
	/**
	 * Visible related products, never the product itself. `specific`: at most
	 * 12, in the merchant's order. `category`: at most 8, newest first, without
	 * sold-out products when the shop hides them. Always empty for `none`.
	 */
	products: RelatedProductSummary[];
}

/**
 * A product as the storefront sees it — visible products only, no cost prices,
 * no supplier data.
 */
export interface Product {
	/** Prefixed id (`prod_123`). Pass it straight back to `cart.addItem`. */
	id: string;
	name: string | null;
	/** Display price of the product, in minor units. */
	price: MinorUnits | null;
	/**
	 * The currency every price on this product is in — the client's chosen
	 * currency when the shop offers it, else the shop's own. Format with this,
	 * never a hardcoded code.
	 */
	currency?: CurrencyCode;
	description: string | null;
	slug: string | null;
	visible: boolean | null;
	/** VAT percentage (25, 12, 6 …). */
	taxRate: number | null;
	seoTitle: string | null;
	seoDescription: string | null;
	images: ProductImage[];
	options?: ProductOptionType[];
	variants: ProductVariant[];
	/** Merchant-authored content sections, in the merchant's order. */
	sections?: ProductSection[];
	/** Fields the shopper fills in when buying, in the merchant's order. */
	fields?: ProductField[];
	/**
	 * The product's related products. Served **only** by a single-product read
	 * (`products.get`); absent on `products.list` and search results.
	 */
	relatedProducts?: RelatedProducts;
	/**
	 * Who this product was priced for (a guest, a customer, a customer
	 * group). Served by a single-product read (`products.get`,
	 * `getBySlug`); list and search results carry it once per page, as
	 * `page.meta.pricing`.
	 */
	pricing?: CatalogPricing;
}

/** One entry of {@link Category.ancestors}: a lightweight parent reference. */
export interface CategoryAncestor {
	/** Prefixed id (`cat_2`). */
	id: string;
	name: string | null;
	/** The ancestor's own slug segment, not its full path. */
	slug: string | null;
}

export interface Category {
	/** Prefixed id (`cat_12`). */
	id: string;
	name: string | null;
	slug: string | null;
	parentId: string | null;
	description: string | null;
	description1: string | null;
	description2: string | null;
	/**
	 * The bare storage filename of the cover image. Not a URL — see
	 * {@link Category.imageUrl}.
	 */
	image: string | null;
	/**
	 * Absolute URL of the cover image, with no resize parameters. Null when the
	 * category has no image. Resolve it with `resolveCategoryImageUrl`.
	 */
	imageUrl: string | null;
	seoTitle: string | null;
	/**
	 * Ancestors ordered root to immediate parent. Empty for a top-level
	 * category.
	 */
	ancestors: CategoryAncestor[];
	/** Full slug path, e.g. `clothing/shirts`. */
	path: string | null;
	childCount: number;
}

export interface CategoryListParams {
	limit?: number;
	cursor?: string;
	parentId?: string;
	/** Only top-level categories. */
	root?: boolean;
	search?: string;
}

/**
 * Every product states the currency its prices are in as `product.currency`
 * (the client's chosen currency when the shop offers it, else the shop's own).
 */
export type ProductCurrency = CurrencyCode;
