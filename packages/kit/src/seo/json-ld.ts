import type { Product, ProductVariant } from "../sdk/types/catalog.js";
import type { CurrencyCode } from "../sdk/types/common.js";
import type { Shop } from "../sdk/types/shop.js";
import { buildPriceState } from "../state/variant-matrix.js";
import { formatSchemaPrice } from "./money.js";
import type { SchemaAvailability, SeoBreadcrumb } from "./types.js";

/**
 * Availability for one variant. `preorder` wins; untracked stock
 * (`stock: null`) counts as InStock.
 */
export function variantAvailability(
	variant: ProductVariant,
): SchemaAvailability {
	if (variant.stock?.preorder === true) return "https://schema.org/PreOrder";
	const stock = variant.stock?.stock;
	if (typeof stock === "number" && stock <= 0) {
		return "https://schema.org/OutOfStock";
	}
	return "https://schema.org/InStock";
}

/** The most optimistic availability across a product's variants. */
export function productAvailability(product: Product): SchemaAvailability {
	const purchasable = product.variants.filter((v) => v.hidden !== true);
	if (purchasable.length === 0) return "https://schema.org/OutOfStock";
	const all = purchasable.map(variantAvailability);
	if (all.includes("https://schema.org/InStock")) {
		return "https://schema.org/InStock";
	}
	if (all.includes("https://schema.org/PreOrder")) {
		return "https://schema.org/PreOrder";
	}
	return "https://schema.org/OutOfStock";
}

export interface ProductJsonLdOptions {
	url?: string;
	currency?: CurrencyCode;
	images?: string[];
	brand?: string;
}

/**
 * schema.org `Product`. Price and availability go in an `Offer`, or an
 * `AggregateOffer` when variant prices differ. Offers are omitted when no
 * currency is known.
 */
export function productJsonLd(
	product: Product,
	options: ProductJsonLdOptions = {},
): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "Product",
		name: product.name ?? undefined,
	};

	if (product.description) node.description = product.description;
	if (options.url) node.url = options.url;
	if (options.images?.length) node.image = options.images;
	if (options.brand) node.brand = { "@type": "Brand", name: options.brand };

	// Only a single-variant product has one SKU to give.
	const purchasable = product.variants.filter((v) => v.hidden !== true);
	const soleVariant = purchasable.length === 1 ? purchasable[0] : undefined;
	if (soleVariant?.sku) node.sku = soleVariant.sku;
	if (soleVariant?.barcode) node.gtin = soleVariant.barcode;

	const offers = buildOffers(product, options);
	if (offers) node.offers = offers;

	return node;
}

function buildOffers(
	product: Product,
	options: ProductJsonLdOptions,
): Record<string, unknown> | undefined {
	const { currency, url } = options;
	if (!currency) return undefined;

	const price = buildPriceState(product, {});
	if (price.min === null || price.max === null) return undefined;

	const availability = productAvailability(product);
	const base = {
		priceCurrency: currency.toUpperCase(),
		availability,
		...(url ? { url } : {}),
	};

	if (!price.isRange) {
		return {
			"@type": "Offer",
			...base,
			price: formatSchemaPrice(price.min, currency),
		};
	}

	const purchasable = product.variants.filter((v) => v.hidden !== true);
	return {
		"@type": "AggregateOffer",
		...base,
		lowPrice: formatSchemaPrice(price.min, currency),
		highPrice: formatSchemaPrice(price.max, currency),
		offerCount: purchasable.length,
	};
}

/** schema.org `BreadcrumbList`. Entries without a name are dropped. */
export function breadcrumbJsonLd(
	items: SeoBreadcrumb[],
): Record<string, unknown> | undefined {
	const named = items.filter((item) => item.name);
	if (named.length === 0) return undefined;
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: named.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			...(item.url ? { item: item.url } : {}),
		})),
	};
}

/** schema.org `Organization` — the shop itself, for the knowledge panel. */
export function organizationJsonLd(
	shop: Shop,
	options: { url?: string } = {},
): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: shop.name,
	};
	const url = options.url ?? shop.storeUrl;
	if (url) node.url = url;
	if (shop.brand?.logo) node.logo = shop.brand.logo;
	return node;
}

/**
 * Serialize structured data for a `<script type="application/ld+json">`.
 * Every `<` is escaped as `\u003c` so content containing `</script>` cannot
 * close the tag.
 */
export function serializeJsonLd(node: unknown): string {
	return JSON.stringify(node).replace(/</g, "\\u003c");
}
