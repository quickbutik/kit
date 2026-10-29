"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { buildSeo } from "../seo/build.js";
import { serializeJsonLd } from "../seo/json-ld.js";
import type { SeoDefaults, SeoInput, SeoTags } from "../seo/types.js";
import { useOptionalProductState } from "./product-context.js";

const SeoDefaultsContext = createContext<SeoDefaults>({});

export interface SeoProviderProps extends SeoDefaults {
	children: ReactNode;
}

/**
 * Site-wide SEO values, so a page only names what is specific to it.
 *
 * Put it near the root with the things every page repeats — the storefront's
 * origin, the shop, the default share image:
 *
 * ```tsx
 * <SeoProvider baseUrl="https://myshop.com" shop={shop} currency="SEK" organization>
 *   {children}
 * </SeoProvider>
 * ```
 *
 * Renders nothing of its own.
 */
export function SeoProvider({
	children,
	...defaults
}: SeoProviderProps): ReactNode {
	// Keyed on the serialized defaults, not their identity: callers pass an
	// inline object, and the payload is small plain data.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serialized key IS the dependency; listing `defaults` would defeat it.
	const value = useMemo(() => defaults, [JSON.stringify(defaults)]);
	return (
		<SeoDefaultsContext.Provider value={value}>
			{children}
		</SeoDefaultsContext.Provider>
	);
}

/**
 * Drop keys whose value is `undefined`, so a later spread cannot erase an
 * earlier layer's value with a missing one.
 */
function withoutUndefined<T extends object>(source: T): T {
	const out: Record<string, unknown> = {};
	// `T extends object`, not `Record<string, unknown>`: interfaces with optional
	// members are not assignable to an index-signature type.
	for (const [key, value] of Object.entries(
		source as Record<string, unknown>,
	)) {
		if (value !== undefined) out[key] = value;
	}
	return out as T;
}

/** The defaults in scope. Empty when there is no `SeoProvider` above. */
export function useSeoDefaults(): SeoDefaults {
	return useContext(SeoDefaultsContext);
}

/**
 * The resolved head payload for a page, merged with the defaults in scope.
 *
 * Use this when the framework wants the data rather than the tags — a TanStack
 * Start `head()`, an Astro layout, or a Next `generateMetadata` (with
 * `toNextMetadata`). `<SEO />` is this plus the rendering.
 */
export function useSeo(input: SeoInput & SeoDefaults = {}): SeoTags {
	const defaults = useSeoDefaults();
	// Product and currency come from `<ProductProvider>` when there is one; an
	// explicit `product` still wins.
	const productState = useOptionalProductState();
	// `withoutUndefined`, so an undefined `currency` or `product` does not
	// overwrite the value from the provider or context.
	const resolved: SeoInput & SeoDefaults = {
		...defaults,
		...withoutUndefined(
			productState
				? { product: productState.product, currency: productState.currency }
				: {},
		),
		...withoutUndefined(input),
	};

	// Keyed on serialized values, like `SeoProvider`, except `product` and
	// `category`: whole API records, costly to serialize on every render and
	// already identity-stable when unchanged.
	const { product, category, ...rest } = resolved;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serialized key IS the dependency.
	return useMemo(
		() => buildSeo(resolved),
		[product, category, JSON.stringify(rest)],
	);
}

export interface SeoProps extends SeoInput, SeoDefaults {
	/**
	 * Skip `<title>`. Set this when the framework owns the title (a Next
	 * `metadata` export, or `react-helmet`) to avoid two competing titles.
	 */
	skipTitle?: boolean;
	/** Skip the `<script type="application/ld+json">` blocks. */
	skipJsonLd?: boolean;
}

/**
 * Every meta tag a Quickbutik page should have, from the product, category or
 * shop you hand it.
 *
 * Inside a `<ProductProvider>` it needs nothing: the product and
 * currency come from that context, and the canonical from the `productPath`
 * template on `<SeoProvider>`.
 *
 * ```tsx
 * <ProductProvider slug={slug}>
 *   <SEO />
 * </ProductProvider>
 *
 * // Or explicitly, outside a product context:
 * <SEO product={product} url={`/products/${product.slug}`} />
 * <SEO category={category} url={`/categories/${category.slug}`} />
 * <SEO title="Sök" noIndex />
 * ```
 *
 * React 19 hoists `<title>`, `<meta>` and `<link>` into `<head>` from anywhere
 * in the tree. On React 18 they render inline where the component sits and
 * `<title>` will not work, so use {@link useSeo} with the framework's own head
 * mechanism instead. JSON-LD is never hoisted and does not need to be.
 *
 * In Next.js App Router, `generateMetadata` + `toNextMetadata()` gives Next
 * control of the title, but Next's `Metadata` has no slot for structured data,
 * so pair it with `<JsonLd>`. Rendering `<SEO />` alone emits both.
 */
export function SEO({ skipTitle, skipJsonLd, ...input }: SeoProps): ReactNode {
	const tags = useSeo(input);
	return (
		<>
			{skipTitle ? null : <title>{tags.title}</title>}
			{tags.description ? (
				<meta name="description" content={tags.description} />
			) : null}
			{tags.canonical ? <link rel="canonical" href={tags.canonical} /> : null}
			<meta
				name="robots"
				content={`${tags.robots.index ? "index" : "noindex"},${
					tags.robots.follow ? "follow" : "nofollow"
				}`}
			/>

			<meta property="og:title" content={tags.openGraph.title} />
			{tags.openGraph.description ? (
				<meta property="og:description" content={tags.openGraph.description} />
			) : null}
			<meta property="og:type" content={tags.openGraph.type} />
			{tags.openGraph.url ? (
				<meta property="og:url" content={tags.openGraph.url} />
			) : null}
			{tags.openGraph.siteName ? (
				<meta property="og:site_name" content={tags.openGraph.siteName} />
			) : null}
			{tags.openGraph.locale ? (
				<meta property="og:locale" content={tags.openGraph.locale} />
			) : null}
			{tags.openGraph.images.map((image) => (
				<meta key={image.url} property="og:image" content={image.url} />
			))}
			{tags.openGraph.images[0]?.alt ? (
				<meta property="og:image:alt" content={tags.openGraph.images[0].alt} />
			) : null}
			{tags.openGraph.price ? (
				<>
					<meta
						property="product:price:amount"
						content={tags.openGraph.price.amount}
					/>
					<meta
						property="product:price:currency"
						content={tags.openGraph.price.currency}
					/>
				</>
			) : null}
			{tags.openGraph.availability ? (
				<meta
					property="product:availability"
					content={tags.openGraph.availability}
				/>
			) : null}

			<meta name="twitter:card" content={tags.twitter.card} />
			<meta name="twitter:title" content={tags.twitter.title} />
			{tags.twitter.description ? (
				<meta name="twitter:description" content={tags.twitter.description} />
			) : null}
			{tags.twitter.site ? (
				<meta name="twitter:site" content={tags.twitter.site} />
			) : null}
			{tags.twitter.creator ? (
				<meta name="twitter:creator" content={tags.twitter.creator} />
			) : null}
			{tags.twitter.images[0] ? (
				<meta name="twitter:image" content={tags.twitter.images[0]} />
			) : null}

			{tags.meta.map((entry) => (
				<meta key={entry.name} name={entry.name} content={entry.content} />
			))}

			{skipJsonLd ? null : <JsonLd data={tags.jsonLd} />}
		</>
	);
}

export interface JsonLdProps {
	/** One schema.org node, or several. Empty/absent renders nothing. */
	data:
		| Record<string, unknown>
		| Array<Record<string, unknown>>
		| null
		| undefined;
}

/**
 * schema.org structured data as `<script type="application/ld+json">`.
 *
 * For use alongside `toNextMetadata()`, whose output has no slot for
 * structured data:
 *
 * ```tsx
 * const tags = buildSeo({ product, ...defaults })
 * return <><JsonLd data={tags.jsonLd} />…</>
 * ```
 *
 * Serialization escapes `<`, so a product name containing `</script>` cannot
 * break out of the tag.
 */
export function JsonLd({ data }: JsonLdProps): ReactNode {
	const nodes = data ? (Array.isArray(data) ? data : [data]) : [];
	if (nodes.length === 0) return null;
	return (
		<>
			{nodes.map((node, index) => (
				<script
					// biome-ignore lint/suspicious/noArrayIndexKey: schema.org nodes have no stable id, and the list is render-stable.
					key={index}
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: the only way to emit a JSON-LD script body; `serializeJsonLd` escapes `<`.
					dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}
				/>
			))}
		</>
	);
}
