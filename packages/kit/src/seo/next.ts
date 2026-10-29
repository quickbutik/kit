import type { SeoTags } from "./types.js";

/**
 * The subset of Next.js `Metadata` that `buildSeo` fills, declared without a
 * dependency on `next`. Assignable to Next's `Metadata`.
 */
export interface NextLikeMetadata {
	title?: string;
	description?: string;
	alternates?: { canonical?: string };
	robots?: { index: boolean; follow: boolean };
	openGraph?: {
		title?: string;
		description?: string;
		url?: string;
		type?: string;
		siteName?: string;
		locale?: string;
		images?: Array<{
			url: string;
			alt?: string;
			width?: number;
			height?: number;
		}>;
	};
	twitter?: {
		card?: "summary" | "summary_large_image";
		title?: string;
		description?: string;
		site?: string;
		creator?: string;
		images?: string[];
	};
	other?: Record<string, string>;
}

/**
 * Adapt {@link SeoTags} for a Next.js App Router `generateMetadata` export.
 *
 * ```ts
 * export async function generateMetadata({ params }) {
 *   const product = await getProduct((await params).slug)
 *   return toNextMetadata(buildSeo({ product, ...defaults }))
 * }
 * ```
 *
 * **Structured data is not included**: Next's `Metadata` has no slot for it,
 * so render `tags.jsonLd` in the page with `<JsonLd data={tags.jsonLd} />`
 * (or use `<SEO />`, which emits both).
 */
export function toNextMetadata(tags: SeoTags): NextLikeMetadata {
	const metadata: NextLikeMetadata = {
		title: tags.title,
		description: tags.description,
		robots: tags.robots,
	};

	if (tags.canonical) metadata.alternates = { canonical: tags.canonical };

	metadata.openGraph = {
		title: tags.openGraph.title,
		description: tags.openGraph.description,
		url: tags.openGraph.url,
		// Next's types omit "product", but it forwards the string as is.
		type: tags.openGraph.type,
		siteName: tags.openGraph.siteName,
		locale: tags.openGraph.locale,
		images:
			tags.openGraph.images.length > 0 ? tags.openGraph.images : undefined,
	};

	metadata.twitter = {
		card: tags.twitter.card,
		title: tags.twitter.title,
		description: tags.twitter.description,
		site: tags.twitter.site,
		creator: tags.twitter.creator,
		images: tags.twitter.images.length > 0 ? tags.twitter.images : undefined,
	};

	// `other` carries arbitrary meta tags, including OpenGraph product extensions.
	const other: Record<string, string> = {};
	for (const { name, content } of tags.meta) other[name] = content;
	if (tags.openGraph.price) {
		other["product:price:amount"] = tags.openGraph.price.amount;
		other["product:price:currency"] = tags.openGraph.price.currency;
	}
	if (tags.openGraph.availability) {
		other["product:availability"] = tags.openGraph.availability;
	}
	if (Object.keys(other).length > 0) metadata.other = other;

	return metadata;
}
