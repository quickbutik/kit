import { describe, expect, it } from "vitest";
import {
	absoluteUrl,
	applyTitleTemplate,
	breadcrumbJsonLd,
	buildSeo,
	currencyDecimals,
	formatSchemaPrice,
	plainText,
	productAvailability,
	productJsonLd,
	serializeJsonLd,
	toNextMetadata,
} from "../src/index.js";
import type {
	Category,
	Product,
	ProductVariant,
} from "../src/sdk/types/catalog.js";
import type { Shop } from "../src/sdk/types/shop.js";

const SHOP: Shop = {
	name: "Min butik",
	storeUrl: "https://store.example.test",
	termsUrl: null,
	language: "sv",
	brand: {
		logo: "https://cdn.example.test/logo.png",
		color: { primary: null },
	},
};

function variant(
	id: number,
	price: number | null,
	overrides: Partial<ProductVariant> = {},
): ProductVariant {
	return {
		id,
		sku: `sku-${id}`,
		barcode: null,
		weight: null,
		hidden: null,
		minPurchaseQty: null,
		maxPurchaseQty: null,
		price: { price, comparePrice: null },
		stock: { stock: null, preorder: null },
		options: [],
		...overrides,
	};
}

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: "prod_27",
		name: "Complex Product",
		price: 9900,
		description: "<p>A <strong>nice</strong> thing.</p>",
		slug: "complex-product",
		visible: true,
		taxRate: 25,
		seoTitle: null,
		seoDescription: null,
		images: [
			{
				id: 1,
				productId: 27,
				url: null,
				path: "https://cdn.example.test/p27.jpg",
				position: 1,
				date: null,
				altText: "A nice thing",
				contentHash: null,
			},
		],
		options: [],
		variants: [variant(1, 9900)],
		...overrides,
	};
}

const DEFAULTS = {
	baseUrl: "https://myshop.test",
	shop: SHOP,
	currency: "SEK",
};

describe("plainText", () => {
	it("strips markup and collapses whitespace", () => {
		expect(plainText("<p>A  <b>nice</b>\n thing.</p>")).toBe("A nice thing.");
	});

	it("decodes the entities a description realistically contains", () => {
		expect(plainText("Tea &amp; coffee &quot;blend&quot;")).toBe(
			'Tea & coffee "blend"',
		);
	});

	it("truncates on a word boundary", () => {
		const long = `${"word ".repeat(100)}end`;
		const actual = plainText(long, 50);
		expect(actual?.length).toBeLessThanOrEqual(51);
		expect(actual?.endsWith("…")).toBe(true);
		expect(actual).not.toMatch(/wor…$/);
	});

	it("is undefined for empty or markup-only input", () => {
		expect(plainText(null)).toBeUndefined();
		expect(plainText("<p></p>")).toBeUndefined();
	});
});

describe("formatSchemaPrice", () => {
	it("renders minor units as a decimal string", () => {
		expect(formatSchemaPrice(9900, "SEK")).toBe("99.00");
		expect(formatSchemaPrice(99900, "SEK")).toBe("999.00");
		expect(formatSchemaPrice(1234, "EUR")).toBe("12.34");
	});

	it("respects a zero-decimal currency", () => {
		// JPY has no minor unit: dividing by 100 would report ¥990 as ¥9.90.
		expect(currencyDecimals("JPY")).toBe(0);
		expect(formatSchemaPrice(990, "JPY")).toBe("990");
	});

	it("pads the fraction", () => {
		expect(formatSchemaPrice(9905, "SEK")).toBe("99.05");
		expect(formatSchemaPrice(5, "SEK")).toBe("0.05");
	});
});

describe("absoluteUrl", () => {
	it("passes an absolute URL through", () => {
		expect(absoluteUrl("https://a.test/x", "https://b.test")).toBe(
			"https://a.test/x",
		);
	});

	it("resolves a path against the base", () => {
		expect(absoluteUrl("/products/x", "https://myshop.test")).toBe(
			"https://myshop.test/products/x",
		);
	});

	it("is undefined for a relative path with no base", () => {
		// A relative canonical is worse than none: it resolves against whatever
		// URL the crawler happens to be on.
		expect(absoluteUrl("/products/x", undefined)).toBeUndefined();
	});
});

describe("applyTitleTemplate", () => {
	it("appends the site name by default", () => {
		expect(applyTitleTemplate("Skor", "Min butik", undefined)).toBe(
			"Skor · Min butik",
		);
	});

	it("honours a custom template", () => {
		expect(applyTitleTemplate("Skor", "Min butik", "%s | Min butik")).toBe(
			"Skor | Min butik",
		);
	});

	it("does not repeat the site name on the homepage", () => {
		expect(applyTitleTemplate("Min butik", "Min butik", undefined)).toBe(
			"Min butik",
		);
	});
});

describe("buildSeo — product page", () => {
	it("prefers the merchant's SEO fields over the product name", () => {
		// The whole point: seoTitle/seoDescription exist for this and are
		// otherwise invisible to a headless storefront.
		const tags = buildSeo({
			...DEFAULTS,
			product: product({
				seoTitle: "Buy the Complex Product online",
				seoDescription: "Free shipping over 500 kr.",
			}),
			url: "/products/complex-product",
		});

		expect(tags.title).toBe("Buy the Complex Product online · Min butik");
		expect(tags.description).toBe("Free shipping over 500 kr.");
	});

	it("falls back to the name and a cleaned description", () => {
		const tags = buildSeo({ ...DEFAULTS, product: product() });
		expect(tags.title).toBe("Complex Product · Min butik");
		expect(tags.description).toBe("A nice thing.");
	});

	it("builds an absolute canonical from a path", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			url: "/products/complex-product",
		});
		expect(tags.canonical).toBe("https://myshop.test/products/complex-product");
		expect(tags.openGraph.url).toBe(tags.canonical);
	});

	it("uses og:type=product and the product image", () => {
		const tags = buildSeo({ ...DEFAULTS, product: product() });
		expect(tags.openGraph.type).toBe("product");
		expect(tags.openGraph.images[0]).toEqual({
			url: "https://cdn.example.test/p27.jpg",
			alt: "A nice thing",
		});
		expect(tags.twitter.card).toBe("summary_large_image");
	});

	it("derives og:locale from the shop language", () => {
		expect(buildSeo({ ...DEFAULTS, product: product() }).openGraph.locale).toBe(
			"sv_SE",
		);
	});

	it("emits the OpenGraph price only with a currency", () => {
		const withCurrency = buildSeo({ ...DEFAULTS, product: product() });
		expect(withCurrency.openGraph.price).toEqual({
			amount: "99.00",
			currency: "SEK",
		});

		const without = buildSeo({
			...DEFAULTS,
			currency: undefined,
			product: product(),
		});
		expect(without.openGraph.price).toBeUndefined();
	});

	it("marks a noIndex page in robots", () => {
		const tags = buildSeo({ ...DEFAULTS, title: "Sök", noIndex: true });
		expect(tags.robots).toEqual({ index: false, follow: true });
	});
});

describe("buildSeo — structured data", () => {
	it("emits a Product node with a single Offer", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			url: "/products/complex-product",
		});
		const node = tags.jsonLd[0] as Record<string, unknown>;

		expect(node["@type"]).toBe("Product");
		expect(node.name).toBe("Complex Product");
		expect(node.sku).toBe("sku-1");
		expect(node.offers).toEqual({
			"@type": "Offer",
			priceCurrency: "SEK",
			availability: "https://schema.org/InStock",
			url: "https://myshop.test/products/complex-product",
			price: "99.00",
		});
	});

	it("emits an AggregateOffer when the variants differ in price", () => {
		// The honest shape for "från 99 kr" — Google reads lowPrice/highPrice.
		const tags = buildSeo({
			...DEFAULTS,
			product: product({ variants: [variant(1, 9900), variant(2, 99900)] }),
		});
		const node = tags.jsonLd[0] as Record<string, unknown>;

		expect(node.offers).toMatchObject({
			"@type": "AggregateOffer",
			lowPrice: "99.00",
			highPrice: "999.00",
			offerCount: 2,
		});
		// No single SKU to claim when there are several variants.
		expect(node.sku).toBeUndefined();
	});

	it("omits offers entirely without a currency", () => {
		// priceCurrency is required; a guessed one would publish a wrong price.
		const tags = buildSeo({
			...DEFAULTS,
			currency: undefined,
			product: product(),
		});
		expect((tags.jsonLd[0] as Record<string, unknown>).offers).toBeUndefined();
	});

	it("reports availability from stock, treating null as purchasable", () => {
		// A shop that does not track inventory must not vanish from rich results.
		expect(productAvailability(product())).toBe("https://schema.org/InStock");
		expect(
			productAvailability(
				product({
					variants: [variant(1, 100, { stock: { stock: 0, preorder: null } })],
				}),
			),
		).toBe("https://schema.org/OutOfStock");
		expect(
			productAvailability(
				product({
					variants: [variant(1, 100, { stock: { stock: 0, preorder: true } })],
				}),
			),
		).toBe("https://schema.org/PreOrder");
	});

	it("is InStock when any variant is", () => {
		expect(
			productAvailability(
				product({
					variants: [
						variant(1, 100, { stock: { stock: 0, preorder: null } }),
						variant(2, 100, { stock: { stock: 3, preorder: null } }),
					],
				}),
			),
		).toBe("https://schema.org/InStock");
	});

	it("ignores hidden variants when pricing and stocking", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product({
				variants: [variant(1, 9900), variant(2, 99900, { hidden: true })],
			}),
		});
		expect(
			(tags.jsonLd[0] as Record<string, { price?: string }>).offers?.price,
		).toBe("99.00");
	});

	it("derives a two-level trail for a product page", () => {
		// Structurally always true — site root, then the product at its canonical.
		// Better than guessing a category the page never named, and enough for
		// Google to show the site name as the parent.
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			url: "/products/complex-product",
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList");

		expect(crumbs).toMatchObject({
			itemListElement: [
				{ position: 1, name: "Min butik", item: "https://myshop.test" },
				{
					position: 2,
					name: "Complex Product",
					item: "https://myshop.test/products/complex-product",
				},
			],
		});
	});

	it("skips the derived trail when there is no canonical to point at", () => {
		const tags = buildSeo({
			...DEFAULTS,
			baseUrl: undefined,
			product: product(),
		});
		expect(tags.jsonLd.some((n) => n["@type"] === "BreadcrumbList")).toBe(
			false,
		);
	});

	it("lets explicit breadcrumbs replace the derived trail", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			url: "/products/complex-product",
			breadcrumbs: [
				{ name: "Hem", url: "/" },
				{ name: "Skjortor", url: "/c/skjortor" },
				{ name: "Complex Product", url: "/products/complex-product" },
			],
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList") as {
			itemListElement: Array<{ name: string }>;
		};
		expect(crumbs.itemListElement.map((i) => i.name)).toEqual([
			"Hem",
			"Skjortor",
			"Complex Product",
		]);
	});

	it("builds the canonical from productPath when the page gives no url", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			productPath: "/products/{slug}",
		});
		expect(tags.canonical).toBe("https://myshop.test/products/complex-product");
	});

	it("omits the canonical rather than emitting a literal placeholder", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product({ slug: null }),
			productPath: "/products/{slug}",
		});
		expect(tags.canonical).toBeUndefined();
	});

	it("adds Organization when asked", () => {
		const tags = buildSeo({ ...DEFAULTS, organization: true });
		const org = tags.jsonLd.find((node) => node["@type"] === "Organization");
		expect(org).toMatchObject({
			name: "Min butik",
			logo: "https://cdn.example.test/logo.png",
		});
	});
});

describe("buildSeo — category page", () => {
	const category: Category = {
		id: "cat_5",
		name: "Skjortor",
		slug: "skjortor",
		parentId: "cat_2",
		description: "<p>Alla skjortor</p>",
		description1: null,
		description2: null,
		image: "https://cdn.example.test/cat5.jpg",
		imageUrl: null,
		seoTitle: null,
		ancestors: [{ id: "cat_2", name: "Kläder", slug: "klader" }],
		path: "klader/skjortor",
		childCount: 0,
	};

	it("titles from the category and uses og:type=website", () => {
		const tags = buildSeo({ ...DEFAULTS, category, url: "/c/skjortor" });
		expect(tags.title).toBe("Skjortor · Min butik");
		expect(tags.description).toBe("Alla skjortor");
		expect(tags.openGraph.type).toBe("website");
	});

	it("names the derived trail from the category's ancestors", () => {
		// The parent's real name, not a label recovered from its slug, is what a
		// search result shows.
		const tags = buildSeo({ ...DEFAULTS, category, url: "/c/skjortor" });
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList");

		expect(crumbs).toMatchObject({
			itemListElement: [
				{ position: 1, name: "Kläder" },
				{
					position: 2,
					name: "Skjortor",
					item: "https://myshop.test/c/skjortor",
				},
			],
		});
	});

	it("labels an ancestor that has no name from its slug", () => {
		const tags = buildSeo({
			...DEFAULTS,
			category: {
				...category,
				ancestors: [{ id: "cat_2", name: null, slug: "winter-jackets" }],
				path: "winter-jackets/skjortor",
			},
			url: "/c/skjortor",
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList") as {
			itemListElement: Array<{ name: string }>;
		};
		expect(crumbs.itemListElement.map((i) => i.name)).toEqual([
			"Winter jackets",
			"Skjortor",
		]);
	});

	it("falls back to the slug label for an empty name or an unmatched segment", () => {
		// An empty name is no name, and a segment with no ancestor behind it still
		// gets a readable entry rather than a hole in the trail.
		const tags = buildSeo({
			...DEFAULTS,
			category: {
				...category,
				ancestors: [{ id: "cat_1", name: "", slug: "herr" }],
				path: "herr/vinterjackor/skjortor",
			},
			url: "/c/skjortor",
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList") as {
			itemListElement: Array<{ name: string }>;
		};
		expect(crumbs.itemListElement.map((i) => i.name)).toEqual([
			"Herr",
			"Vinterjackor",
			"Skjortor",
		]);
	});

	it("matches ancestors to path segments by slug, not by position", () => {
		// `path` skips an ancestor without a slug, so the second segment here
		// belongs to the third ancestor.
		const tags = buildSeo({
			...DEFAULTS,
			category: {
				...category,
				parentId: "cat_3",
				ancestors: [
					{ id: "cat_1", name: "Herr", slug: "herr" },
					{ id: "cat_2", name: "Ytterkläder", slug: null },
					{ id: "cat_3", name: "Kläder", slug: "klader" },
				],
				path: "herr/klader/skjortor",
			},
			url: "/c/skjortor",
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList") as {
			itemListElement: unknown[];
		};
		expect(crumbs.itemListElement).toEqual([
			{ "@type": "ListItem", position: 1, name: "Herr" },
			{ "@type": "ListItem", position: 2, name: "Kläder" },
			{
				"@type": "ListItem",
				position: 3,
				name: "Skjortor",
				item: "https://myshop.test/c/skjortor",
			},
		]);
	});

	it("prefers explicit breadcrumbs and resolves their URLs", () => {
		const tags = buildSeo({
			...DEFAULTS,
			category,
			breadcrumbs: [
				{ name: "Hem", url: "/" },
				{ name: "Skjortor", url: "/c/skjortor" },
			],
		});
		const crumbs = tags.jsonLd.find((n) => n["@type"] === "BreadcrumbList") as {
			itemListElement: Array<{ item?: string }>;
		};
		expect(crumbs.itemListElement[0]?.item).toBe("https://myshop.test/");
	});
});

describe("serializeJsonLd", () => {
	it("escapes < so a product name cannot close the script tag", () => {
		// Product names are merchant-authored; without this, `</script>` in a name
		// turns shop content into executable markup.
		const payload = serializeJsonLd({
			name: 'Evil </script><img src=x onerror="alert(1)">',
		});

		expect(payload).not.toContain("</script>");
		expect(payload).not.toContain("<img");
		expect(payload).toContain("\\u003c");
		// Still valid JSON, and still the original string once parsed.
		expect(JSON.parse(payload).name).toContain("</script>");
	});
});

describe("toNextMetadata", () => {
	it("maps the payload onto Next's Metadata shape", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product(),
			url: "/products/complex-product",
		});
		const metadata = toNextMetadata(tags);

		expect(metadata.title).toBe("Complex Product · Min butik");
		expect(metadata.alternates?.canonical).toBe(
			"https://myshop.test/products/complex-product",
		);
		expect(metadata.openGraph?.type).toBe("product");
		expect(metadata.openGraph?.images?.[0]?.url).toBe(
			"https://cdn.example.test/p27.jpg",
		);
		expect(metadata.twitter?.card).toBe("summary_large_image");
	});

	it("routes OpenGraph product extensions through `other`", () => {
		// Next's Metadata has no typed slot for these.
		const metadata = toNextMetadata(
			buildSeo({ ...DEFAULTS, product: product() }),
		);
		expect(metadata.other).toMatchObject({
			"product:price:amount": "99.00",
			"product:price:currency": "SEK",
			"product:availability": "https://schema.org/InStock",
		});
	});

	it("carries robots through", () => {
		const metadata = toNextMetadata(
			buildSeo({ ...DEFAULTS, title: "Sök", noIndex: true }),
		);
		expect(metadata.robots).toEqual({ index: false, follow: true });
	});
});

describe("productJsonLd + breadcrumbJsonLd directly", () => {
	it("takes an explicit brand", () => {
		const node = productJsonLd(product(), { brand: "Acme" });
		expect(node.brand).toEqual({ "@type": "Brand", name: "Acme" });
	});

	it("drops unnamed breadcrumbs rather than leaving a position hole", () => {
		const node = breadcrumbJsonLd([
			{ name: "Hem", url: "/" },
			{ name: "", url: "/x" },
			{ name: "Skjortor" },
		]) as { itemListElement: Array<{ position: number; name: string }> };

		expect(node.itemListElement.map((i) => i.position)).toEqual([1, 2]);
		expect(node.itemListElement.map((i) => i.name)).toEqual([
			"Hem",
			"Skjortor",
		]);
	});

	it("is undefined for an empty trail", () => {
		expect(breadcrumbJsonLd([])).toBeUndefined();
	});
});

describe("buildSeo — image URLs", () => {
	it("uses the absolute image url, never the bare storage filename", () => {
		// A filename in og:image would be absolutised against the storefront's own
		// origin and hand every crawler a 404.
		const tags = buildSeo({
			...DEFAULTS,
			product: product({
				images: [
					{
						id: 1,
						productId: 27,
						url: "https://cdn.quickbutik.com/images/ABC1/products/x.jpeg",
						path: "x.jpeg",
						position: 1,
						date: null,
						altText: "Front",
						contentHash: null,
					},
				],
			}),
			url: "/products/complex-product",
		});

		expect(tags.openGraph.images).toEqual([
			{
				url: "https://cdn.quickbutik.com/images/ABC1/products/x.jpeg",
				alt: "Front",
			},
		]);
	});

	it("drops an image that has no url to build from", () => {
		const tags = buildSeo({
			...DEFAULTS,
			product: product({
				images: [
					{
						id: 1,
						productId: 27,
						url: null,
						path: "x.jpeg",
						position: 1,
						date: null,
						altText: null,
						contentHash: null,
					},
				],
			}),
			url: "/products/complex-product",
		});

		expect(tags.openGraph.images).toEqual([]);
		expect(tags.twitter.card).toBe("summary");
	});
});
