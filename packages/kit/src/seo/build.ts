import {
	productImages,
	resolveCategoryImageUrl,
	resolveProductImageUrl,
} from "../media/image-url.js";
import type { Category, Product } from "../sdk/types/catalog.js";
import { buildPriceState } from "../state/variant-matrix.js";
import {
	breadcrumbJsonLd,
	organizationJsonLd,
	productAvailability,
	productJsonLd,
} from "./json-ld.js";
import { formatSchemaPrice } from "./money.js";
import type { SeoBreadcrumb, SeoImage, SeoOptions, SeoTags } from "./types.js";

/**
 * Everything a page needs in `<head>`, from Quickbutik's own data. Prefers
 * the merchant's `seoTitle` / `seoDescription`, falling back to the name and
 * description.
 */
export function buildSeo(options: SeoOptions): SeoTags {
	const { product, category, shop } = options;

	const siteName = options.siteName ?? shop?.name ?? undefined;
	const locale = options.locale ?? localeFromShop(shop?.language);
	const canonical = absoluteUrl(
		options.url ?? templatedPath(options),
		options.baseUrl,
	);

	const base = product
		? fromProduct(product)
		: category
			? fromCategory(category)
			: fromShop(siteName, shop?.brand?.description);

	const title = options.title ?? base.title;
	const description = options.description ?? base.description;
	const images = resolveImages(options, base.images);

	const robots = {
		index: options.noIndex !== true,
		follow: options.noFollow !== true,
	};

	return {
		title: applyTitleTemplate(title, siteName, options.titleTemplate),
		description,
		canonical,
		robots,
		openGraph: {
			// No title template: og:site_name already carries the site name.
			title,
			description,
			url: canonical,
			type: product ? "product" : "website",
			siteName,
			locale,
			images,
			...productOpenGraph(options),
		},
		twitter: {
			card: images.length > 0 ? "summary_large_image" : "summary",
			title,
			description,
			site: options.twitterSite,
			creator: options.twitterCreator,
			images: images.map((image) => image.url),
		},
		jsonLd: buildJsonLd(options, canonical, images),
		meta: options.meta ?? [],
	};
}

function fromProduct(product: Product): {
	title: string;
	description?: string;
	images: SeoImage[];
} {
	return {
		title: product.seoTitle ?? product.name ?? "",
		description: product.seoDescription ?? plainText(product.description),
		images: productImages(product).flatMap((image) => {
			// `auto: null` keeps a stable share URL; the cache-buster stays so a
			// replaced image is re-scraped.
			const url = resolveProductImageUrl(image, { auto: null });
			if (!url) return [];
			return [{ url, alt: image.altText ?? product.name ?? undefined }];
		}),
	};
}

function fromCategory(category: Category): {
	title: string;
	description?: string;
	images: SeoImage[];
} {
	const imageUrl = resolveCategoryImageUrl(category, { auto: null });
	return {
		title: category.seoTitle ?? category.name ?? "",
		description: plainText(category.description),
		images: imageUrl
			? [{ url: imageUrl, alt: category.name ?? undefined }]
			: [],
	};
}

function fromShop(
	siteName: string | undefined,
	description: string | null | undefined,
): { title: string; description?: string; images: SeoImage[] } {
	return {
		title: siteName ?? "",
		description: plainText(description),
		images: [],
	};
}

/** OpenGraph's product extensions, only emitted with a known currency and price. */
function productOpenGraph(
	options: SeoOptions,
): Pick<SeoTags["openGraph"], "price" | "availability"> {
	const { product } = options;
	// The product's own currency first: its amounts are in it.
	const currency = product?.currency ?? options.currency;
	if (!product || !currency) return {};
	const price = buildPriceState(product, {});
	if (price.min === null) return {};
	return {
		price: {
			amount: formatSchemaPrice(price.min, currency),
			currency: currency.toUpperCase(),
		},
		availability: productAvailability(product),
	};
}

function buildJsonLd(
	options: SeoOptions,
	canonical: string | undefined,
	images: SeoImage[],
): Array<Record<string, unknown>> {
	const nodes: Array<Record<string, unknown>> = [];

	if (options.product) {
		nodes.push(
			productJsonLd(options.product, {
				url: canonical,
				currency: options.product.currency ?? options.currency,
				images: images.map((image) => image.url),
				brand: options.siteName ?? options.shop?.name,
			}),
		);
	}

	const trail = resolveBreadcrumbs(options);
	const breadcrumbs = trail.length > 0 ? breadcrumbJsonLd(trail) : undefined;
	if (breadcrumbs) nodes.push(breadcrumbs);

	if (options.organization && options.shop) {
		nodes.push(
			organizationJsonLd(options.shop, {
				url: options.baseUrl ?? options.shop.storeUrl ?? undefined,
			}),
		);
	}

	if (options.jsonLd?.length) nodes.push(...options.jsonLd);
	return nodes;
}

/**
 * Explicit breadcrumbs win; otherwise a category page gets one entry per
 * segment of its slug `path` (`clothing/shirts`), named from `ancestors` or
 * the slug.
 */
function resolveBreadcrumbs(options: SeoOptions): SeoBreadcrumb[] {
	if (options.breadcrumbs?.length) {
		return options.breadcrumbs.map((item) => ({
			name: item.name,
			url: absoluteUrl(item.url, options.baseUrl),
		}));
	}
	const { category, product } = options;

	// A product page gets site root → product rather than a guessed category.
	// Pass `breadcrumbs` to describe a real hierarchy.
	if (product && !category) {
		const siteName = options.siteName ?? options.shop?.name;
		const canonical = absoluteUrl(
			options.url ?? templatedPath(options),
			options.baseUrl,
		);
		if (!siteName || !canonical || !options.baseUrl) return [];
		return [
			{ name: siteName, url: options.baseUrl },
			{ name: product.name ?? siteName, url: canonical },
		];
	}

	if (!category?.path) return [];

	const segments = category.path.split("/").filter(Boolean);
	if (segments.length === 0) return [];
	const ancestors = category.ancestors ?? [];
	return segments.map((segment, index) => {
		const isLeaf = index === segments.length - 1;
		// Matched by slug, not index: `path` omits ancestors without a slug.
		const name = isLeaf
			? category.name
			: ancestors.find((ancestor) => ancestor.slug === segment)?.name;
		return {
			name: name || humanize(segment),
			url: isLeaf ? absoluteUrl(options.url, options.baseUrl) : undefined,
		};
	});
}

/** The page's path from a `productPath` / `categoryPath` template, when no `url` was passed. */
function templatedPath(options: SeoOptions): string | undefined {
	const { product, category, productPath, categoryPath } = options;
	if (product && productPath) {
		return fillTemplate(productPath, {
			slug: product.slug ?? undefined,
			id: product.id,
		});
	}
	if (category && categoryPath) {
		return fillTemplate(categoryPath, {
			slug: category.slug ?? undefined,
			id: category.id,
		});
	}
	return undefined;
}

/** Substitute `{slug}` / `{id}`. Undefined when a used placeholder has no value. */
function fillTemplate(
	template: string,
	values: { slug?: string; id?: string },
): string | undefined {
	let out = template;
	for (const [key, value] of Object.entries(values)) {
		const token = `{${key}}`;
		if (!out.includes(token)) continue;
		if (!value) return undefined;
		out = out.replaceAll(token, encodeURIComponent(value));
	}
	return /\{[a-z]+\}/i.test(out) ? undefined : out;
}

/** `winter-jackets` → `Winter jackets`, for a breadcrumb built from a slug. */
function humanize(segment: string): string {
	const spaced = segment.replace(/[-_]+/g, " ").trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolveImages(options: SeoOptions, fallback: SeoImage[]): SeoImage[] {
	const chosen = options.images?.length
		? options.images.map(toImage)
		: fallback.length > 0
			? fallback
			: options.defaultImage
				? [toImage(options.defaultImage)]
				: [];
	// Crawlers and share-card scrapers reject relative image URLs outright.
	return chosen
		.map((image) => ({
			...image,
			url: absoluteUrl(image.url, options.baseUrl) ?? image.url,
		}))
		.filter((image) => Boolean(image.url));
}

function toImage(image: SeoImage | string): SeoImage {
	return typeof image === "string" ? { url: image } : image;
}

/**
 * Compose the document title. `%s` in `template` is the page title; the
 * default appends ` · siteName` unless the title already is the site name.
 */
export function applyTitleTemplate(
	title: string,
	siteName: string | undefined,
	template: string | undefined,
): string {
	if (!title) return siteName ?? "";
	if (template) return template.replace("%s", title);
	if (!siteName || title === siteName) return title;
	return `${title} · ${siteName}`;
}

/**
 * Resolve a possibly-relative URL against the storefront's origin. Returns
 * undefined, not a relative URL, when there is no base: a relative canonical
 * is worse than none.
 */
export function absoluteUrl(
	url: string | undefined,
	baseUrl: string | undefined,
): string | undefined {
	if (!url) return undefined;
	if (/^https?:\/\//i.test(url)) return url;
	if (!baseUrl) return undefined;
	try {
		return new URL(url, ensureTrailingSlash(baseUrl)).toString();
	} catch {
		return undefined;
	}
}

function ensureTrailingSlash(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

/** `sv` → `sv_SE` where the region is unambiguous, for `og:locale`. */
function localeFromShop(
	language: string | null | undefined,
): string | undefined {
	if (!language) return undefined;
	if (language.includes("-") || language.includes("_")) {
		return language.replace("-", "_");
	}
	const regions: Record<string, string> = {
		sv: "sv_SE",
		nb: "nb_NO",
		no: "nb_NO",
		da: "da_DK",
		fi: "fi_FI",
		de: "de_DE",
		nl: "nl_NL",
		en: "en_US",
	};
	return regions[language.toLowerCase()] ?? language;
}

/**
 * Strip tags, decode common entities and collapse whitespace, then cap at
 * `maxLength` on a word boundary.
 */
export function plainText(
	html: string | null | undefined,
	maxLength = 300,
): string | undefined {
	if (!html) return undefined;
	const text = html
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return undefined;
	if (text.length <= maxLength) return text;
	const cut = text.slice(0, maxLength);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
