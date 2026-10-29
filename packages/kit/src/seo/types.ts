import type { Category, Product } from "../sdk/types/catalog.js";
import type { CurrencyCode } from "../sdk/types/common.js";
import type { Shop } from "../sdk/types/shop.js";

/** One image, as OpenGraph and schema.org want it. */
export interface SeoImage {
	url: string;
	alt?: string;
	width?: number;
	height?: number;
}

export interface SeoOpenGraph {
	title: string;
	description?: string;
	url?: string;
	/** `website` for the shop and category pages, `product` for a product. */
	type: "website" | "product" | "article";
	siteName?: string;
	locale?: string;
	images: SeoImage[];
	/** Present only on `type: "product"`, and only when a currency is known. */
	price?: { amount: string; currency: CurrencyCode };
	availability?: SchemaAvailability;
}

export interface SeoTwitter {
	card: "summary" | "summary_large_image";
	title: string;
	description?: string;
	site?: string;
	creator?: string;
	images: string[];
}

/** schema.org availability, the vocabulary Google reads for rich results. */
export type SchemaAvailability =
	| "https://schema.org/InStock"
	| "https://schema.org/OutOfStock"
	| "https://schema.org/PreOrder";

export interface SeoRobots {
	index: boolean;
	follow: boolean;
}

/** Everything a page needs in `<head>`, as plain data. */
export interface SeoTags {
	title: string;
	description?: string;
	/** Absolute canonical URL. Omitted when no `url`/`baseUrl` was available. */
	canonical?: string;
	robots: SeoRobots;
	openGraph: SeoOpenGraph;
	twitter: SeoTwitter;
	/** schema.org objects for `<script type="application/ld+json">`. */
	jsonLd: Array<Record<string, unknown>>;
	/** Extra `<meta name=… content=…>` pairs, e.g. a verification token. */
	meta: Array<{ name: string; content: string }>;
}

/**
 * Site-wide values every page shares. Supply once (via `SeoProvider` or as an
 * argument) so a page only has to name what is specific to it.
 */
export interface SeoDefaults {
	/**
	 * Absolute origin of the storefront, e.g. `https://myshop.com`. Required for
	 * canonical URLs and absolute image URLs.
	 */
	baseUrl?: string;
	/** Shown after the page title. Defaults to the shop's name when a shop is given. */
	siteName?: string;
	/**
	 * How to compose the final title. `%s` is the page title.
	 * Defaults to `"%s · {siteName}"`, and to the bare title with no site name.
	 */
	titleTemplate?: string;
	/** BCP 47 locale for OpenGraph (`sv_SE`). Derived from the shop when absent. */
	locale?: string;
	/** Fallback image for pages with none of their own. */
	defaultImage?: SeoImage | string;
	/** `@handle` of the site, for Twitter cards. */
	twitterSite?: string;
	twitterCreator?: string;
	/**
	 * ISO 4217 code for prices in structured data, when the product has no
	 * `currency` of its own. With neither, no price is emitted.
	 */
	currency?: CurrencyCode;
	/**
	 * Where a product lives, as a template — `"/products/{slug}"`. `{slug}` and
	 * `{id}` are substituted, so `<SEO />` inside `<ProductProvider>` can build
	 * the canonical URL with no props.
	 */
	productPath?: string;
	/** The same for a category — `"/categories/{slug}"`. */
	categoryPath?: string;
	/** The shop, for site name, logo, locale and Organization structured data. */
	shop?: Shop | null;
	/** Emit `Organization` structured data alongside the page's own. */
	organization?: boolean;
}

/** What the page is about. Exactly one of these shapes is used. */
export interface SeoInput {
	/** A product page — emits Product structured data with offers. */
	product?: Product | null;
	/** A category page — emits BreadcrumbList structured data. */
	category?: Category | null;
	/** Trail for BreadcrumbList when the page builds its own. */
	breadcrumbs?: SeoBreadcrumb[];
	/** Overrides whatever the product/category/shop would have produced. */
	title?: string;
	description?: string;
	/** Absolute URL, or a path resolved against `baseUrl`. */
	url?: string;
	images?: Array<SeoImage | string>;
	/** Keep the page out of the index — a search results or filter page. */
	noIndex?: boolean;
	noFollow?: boolean;
	/** Extra structured data to emit as-is. */
	jsonLd?: Array<Record<string, unknown>>;
	meta?: Array<{ name: string; content: string }>;
}

export interface SeoBreadcrumb {
	name: string;
	/** Absolute URL, or a path resolved against `baseUrl`. */
	url?: string;
}

export type SeoOptions = SeoInput & SeoDefaults;
