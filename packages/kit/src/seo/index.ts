/**
 * SEO for a headless Quickbutik storefront.
 *
 * `buildSeo(...)` is framework-free: titles, canonical URLs, OpenGraph,
 * Twitter cards and schema.org data from a product, category or the shop.
 * Use it in Next's `generateMetadata` (via `toNextMetadata`), an Astro layout
 * or a TanStack Start head function. `<SEO />` from `@quickbutik/kit/react`
 * renders the same payload as tags.
 */

export {
	absoluteUrl,
	applyTitleTemplate,
	buildSeo,
	plainText,
} from "./build.js";
export type { ProductJsonLdOptions } from "./json-ld.js";
export {
	breadcrumbJsonLd,
	organizationJsonLd,
	productAvailability,
	productJsonLd,
	serializeJsonLd,
	variantAvailability,
} from "./json-ld.js";
export { currencyDecimals, formatSchemaPrice } from "./money.js";
export type { NextLikeMetadata } from "./next.js";
export { toNextMetadata } from "./next.js";
export type {
	SchemaAvailability,
	SeoBreadcrumb,
	SeoDefaults,
	SeoImage,
	SeoInput,
	SeoOpenGraph,
	SeoOptions,
	SeoRobots,
	SeoTags,
	SeoTwitter,
} from "./types.js";
