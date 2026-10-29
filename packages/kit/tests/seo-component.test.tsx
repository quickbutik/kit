import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonLd, SEO, SeoProvider } from "../src/react/index.js";
import type { Product } from "../src/sdk/types/catalog.js";
import type { Shop } from "../src/sdk/types/shop.js";

const SHOP: Shop = {
	name: "Min butik",
	storeUrl: "https://store.example.test",
	termsUrl: null,
	language: "sv",
	brand: { logo: null, color: { primary: null } },
};

const PRODUCT: Product = {
	id: "prod_27",
	name: "Complex Product",
	price: 9900,
	description: "A nice thing.",
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
	variants: [
		{
			id: 1,
			sku: "sku-1",
			barcode: null,
			weight: null,
			hidden: null,
			minPurchaseQty: null,
			maxPurchaseQty: null,
			price: { price: 9900, comparePrice: null },
			stock: { stock: null, preorder: null },
			options: [],
		},
	],
};

/**
 * Read the rendered tags out of the container.
 *
 * React 19 hoists `title`/`meta`/`link` into `document.head`, so both places are
 * searched — the point of these assertions is that the tag EXISTS with the right
 * content, not which node it ended up under.
 */
function metaContent(container: HTMLElement, selector: string): string | null {
	const node =
		container.querySelector(selector) ?? document.head.querySelector(selector);
	return node?.getAttribute("content") ?? null;
}

function jsonLdNodes(container: HTMLElement): Array<Record<string, unknown>> {
	const scripts = [
		...container.querySelectorAll('script[type="application/ld+json"]'),
		...document.head.querySelectorAll('script[type="application/ld+json"]'),
	];
	return scripts.map((script) => JSON.parse(script.textContent ?? "{}"));
}

function renderSeo(ui: React.ReactNode) {
	return render(
		<SeoProvider baseUrl="https://myshop.test" shop={SHOP} currency="SEK">
			{ui}
		</SeoProvider>,
	);
}

describe("<SEO />", () => {
	it("emits description, canonical and robots", () => {
		const { container } = renderSeo(
			<SEO product={PRODUCT} url="/products/complex-product" />,
		);

		expect(metaContent(container, 'meta[name="description"]')).toBe(
			"A nice thing.",
		);
		const canonical =
			container.querySelector('link[rel="canonical"]') ??
			document.head.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			"https://myshop.test/products/complex-product",
		);
		expect(metaContent(container, 'meta[name="robots"]')).toBe("index,follow");
	});

	it("emits OpenGraph including the product price extensions", () => {
		const { container } = renderSeo(
			<SEO product={PRODUCT} url="/products/complex-product" />,
		);

		expect(metaContent(container, 'meta[property="og:title"]')).toBe(
			"Complex Product",
		);
		expect(metaContent(container, 'meta[property="og:type"]')).toBe("product");
		expect(metaContent(container, 'meta[property="og:site_name"]')).toBe(
			"Min butik",
		);
		expect(metaContent(container, 'meta[property="og:locale"]')).toBe("sv_SE");
		expect(metaContent(container, 'meta[property="og:image"]')).toBe(
			"https://cdn.example.test/p27.jpg",
		);
		expect(
			metaContent(container, 'meta[property="product:price:amount"]'),
		).toBe("99.00");
		expect(
			metaContent(container, 'meta[property="product:price:currency"]'),
		).toBe("SEK");
	});

	it("emits Twitter card tags", () => {
		const { container } = renderSeo(<SEO product={PRODUCT} />);
		expect(metaContent(container, 'meta[name="twitter:card"]')).toBe(
			"summary_large_image",
		);
		expect(metaContent(container, 'meta[name="twitter:image"]')).toBe(
			"https://cdn.example.test/p27.jpg",
		);
	});

	it("emits Product structured data", () => {
		const { container } = renderSeo(
			<SEO product={PRODUCT} url="/products/complex-product" />,
		);
		const nodes = jsonLdNodes(container);
		const productNode = nodes.find((node) => node["@type"] === "Product");

		expect(productNode).toMatchObject({
			name: "Complex Product",
			offers: { "@type": "Offer", price: "99.00", priceCurrency: "SEK" },
		});
	});

	it("honours noIndex", () => {
		const { container } = renderSeo(<SEO title="Sök" noIndex />);
		expect(metaContent(container, 'meta[name="robots"]')).toBe(
			"noindex,follow",
		);
	});

	it("takes per-page overrides ahead of the product's own fields", () => {
		const { container } = renderSeo(
			<SEO product={PRODUCT} description="Overridden." />,
		);
		expect(metaContent(container, 'meta[name="description"]')).toBe(
			"Overridden.",
		);
	});

	it("skips structured data when asked", () => {
		const { container } = renderSeo(<SEO product={PRODUCT} skipJsonLd />);
		expect(
			container.querySelectorAll('script[type="application/ld+json"]'),
		).toHaveLength(0);
	});

	it("works with no provider, using only its own props", () => {
		const { container } = render(
			<SEO title="Standalone" description="No provider here." />,
		);
		expect(metaContent(container, 'meta[name="description"]')).toBe(
			"No provider here.",
		);
		// No baseUrl anywhere, so no canonical rather than a relative one.
		expect(
			container.querySelector('link[rel="canonical"]') ??
				document.head.querySelector('link[rel="canonical"]'),
		).toBeNull();
	});
});

describe("<JsonLd />", () => {
	it("renders nothing for empty input", () => {
		const { container } = render(<JsonLd data={[]} />);
		expect(container.innerHTML).toBe("");
		const { container: nullContainer } = render(<JsonLd data={null} />);
		expect(nullContainer.innerHTML).toBe("");
	});

	it("accepts a single node or an array", () => {
		const { container } = render(
			<JsonLd data={{ "@type": "Thing", name: "One" }} />,
		);
		expect(jsonLdNodes(container)).toEqual([{ "@type": "Thing", name: "One" }]);
	});

	it("escapes a name that would otherwise close the script tag", () => {
		const { container } = render(
			<JsonLd data={{ name: 'x </script><img src=y onerror="alert(1)">' }} />,
		);

		// No injected element, and the value survives a JSON round-trip intact.
		expect(container.querySelector("img")).toBeNull();
		expect(jsonLdNodes(container)[0]?.name).toBe(
			'x </script><img src=y onerror="alert(1)">',
		);
	});
});
