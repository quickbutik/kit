import { describe, expect, it } from "vitest";
import {
	applyImageTransform,
	buildImageSrcSet,
	pickProductImage,
	productImages,
	resolveCategoryImageUrl,
	resolveProductImageUrl,
} from "../src/media/image-url.js";
import type {
	Category,
	Product,
	ProductImage,
} from "../src/sdk/types/catalog.js";

const CDN = "https://cdn.quickbutik.com/images/ABC1";

function image(overrides: Partial<ProductImage> = {}): ProductImage {
	return {
		id: 1,
		productId: 27,
		url: `${CDN}/products/5c7b0e7e1802c.jpeg`,
		path: "5c7b0e7e1802c.jpeg",
		position: 1,
		date: null,
		altText: null,
		contentHash: null,
		...overrides,
	};
}

function product(images: ProductImage[]): Product {
	return {
		id: "prod_27",
		name: "Sneakers",
		price: 9900,
		description: null,
		slug: "sneakers",
		visible: true,
		taxRate: 25,
		seoTitle: null,
		seoDescription: null,
		images,
		options: [],
		variants: [],
	};
}

describe("resolveProductImageUrl", () => {
	it("uses the absolute url the API sends, not the bare filename", () => {
		expect(resolveProductImageUrl(image())).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?auto=format`,
		);
	});

	it("returns null rather than a broken src when there is no image", () => {
		expect(resolveProductImageUrl(null)).toBeNull();
		expect(resolveProductImageUrl(undefined)).toBeNull();
		expect(resolveProductImageUrl(image({ url: null, path: null }))).toBeNull();
	});

	it("returns null for a bare filename with no base to complete it — the whole bug", () => {
		// Rendered as is, this would be <img src="5c7b0e7e1802c.jpeg">.
		expect(resolveProductImageUrl(image({ url: null }))).toBeNull();
	});

	it("falls back to baseUrl + products/ when the API sent no url", () => {
		expect(resolveProductImageUrl(image({ url: null }), { baseUrl: CDN })).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?auto=format`,
		);
	});

	it("normalizes slashes when joining a base and a path", () => {
		expect(
			resolveProductImageUrl(image({ url: null, path: "/x.jpg" }), {
				baseUrl: `${CDN}/`,
				auto: null,
			}),
		).toBe(`${CDN}/products/x.jpg`);
	});

	it("keeps a path that is already an absolute URL", () => {
		for (const path of [
			"https://other.test/x.jpg",
			"//other.test/x.jpg",
			"/uploads/x.jpg",
		]) {
			expect(
				resolveProductImageUrl(image({ url: null, path }), { auto: null }),
			).toBe(path);
		}
	});

	it("appends the content hash as a cache-buster", () => {
		expect(resolveProductImageUrl(image({ contentHash: "f1a2b3" }))).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?auto=format&v=f1a2b3`,
		);
	});

	it("never cache-busts on the `temp` pending sentinel", () => {
		expect(resolveProductImageUrl(image({ contentHash: "temp" }))).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?auto=format`,
		);
	});

	it("honours cacheBust: false", () => {
		expect(
			resolveProductImageUrl(image({ contentHash: "f1a2b3" }), {
				cacheBust: false,
				auto: null,
			}),
		).toBe(`${CDN}/products/5c7b0e7e1802c.jpeg`);
	});

	it("adds the transform params", () => {
		expect(
			resolveProductImageUrl(image(), {
				width: 600,
				height: 400,
				quality: 70,
				format: "webp",
				fit: "crop",
				crop: "faces,center",
				background: "ffffff",
			}),
		).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg` +
				"?auto=format&w=600&h=400&q=70&fm=webp&fit=crop&crop=faces%2Ccenter&bg=ffffff",
		);
	});

	it("rounds fractional sizes — a CDN takes integers", () => {
		expect(resolveProductImageUrl(image(), { width: 199.6, auto: null })).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?w=200`,
		);
	});

	it("merges into a url that already carries a query string", () => {
		expect(
			resolveProductImageUrl(image({ url: `${CDN}/products/x.jpg?sig=abc` }), {
				width: 100,
				auto: null,
			}),
		).toBe(`${CDN}/products/x.jpg?sig=abc&w=100`);
	});
});

describe("resolveCategoryImageUrl", () => {
	const category = (overrides: Partial<Category> = {}): Category => ({
		id: "cat_5",
		name: "Skjortor",
		slug: "skjortor",
		parentId: null,
		description: null,
		description1: null,
		description2: null,
		image: "cat5.jpg",
		imageUrl: `${CDN}/pages/cat5.jpg`,
		seoTitle: null,
		ancestors: [],
		path: "skjortor",
		childCount: 0,
		...overrides,
	});

	it("prefers the absolute imageUrl", () => {
		expect(resolveCategoryImageUrl(category(), { auto: null })).toBe(
			`${CDN}/pages/cat5.jpg`,
		);
	});

	it("falls back to baseUrl + pages/", () => {
		expect(
			resolveCategoryImageUrl(category({ imageUrl: null }), {
				baseUrl: CDN,
				auto: null,
			}),
		).toBe(`${CDN}/pages/cat5.jpg`);
	});

	it("is null for a category with no image", () => {
		expect(
			resolveCategoryImageUrl(category({ image: null, imageUrl: null })),
		).toBeNull();
		expect(resolveCategoryImageUrl(null)).toBeNull();
	});
});

describe("productImages / pickProductImage", () => {
	it("orders by position with nulls last", () => {
		const ordered = productImages(
			product([
				image({ id: 3, position: null }),
				image({ id: 2, position: 5 }),
				image({ id: 1, position: 1 }),
			]),
		);
		expect(ordered.map((i) => i.id)).toEqual([1, 2, 3]);
	});

	it("keeps array order for images that share a position", () => {
		const ordered = productImages(
			product([image({ id: 9, position: 1 }), image({ id: 4, position: 1 })]),
		);
		expect(ordered.map((i) => i.id)).toEqual([9, 4]);
	});

	it("drops images whose file is still processing", () => {
		const images = productImages(
			product([
				image({ id: 1, contentHash: "temp" }),
				image({ id: 2, contentHash: "abc" }),
			]),
		);
		expect(images.map((i) => i.id)).toEqual([2]);
	});

	it("includes pending images on request", () => {
		expect(
			productImages(product([image({ id: 1, contentHash: "temp" })]), true),
		).toHaveLength(1);
	});

	it("drops a placeholder row with no file at all", () => {
		expect(
			productImages(product([image({ id: 1, url: null, path: null })])),
		).toHaveLength(0);
	});

	it("picks the main image by default, and by index or id on request", () => {
		const p = product([
			image({ id: 7, position: 2 }),
			image({ id: 8, position: 1 }),
		]);
		expect(pickProductImage(p)?.id).toBe(8);
		expect(pickProductImage(p, { index: 1 })?.id).toBe(7);
		expect(pickProductImage(p, { imageId: 7 })?.id).toBe(7);
		expect(pickProductImage(p, { imageId: 999 })).toBeNull();
		expect(pickProductImage(p, { index: 9 })).toBeNull();
		expect(pickProductImage(null)).toBeNull();
		expect(pickProductImage(product([]))).toBeNull();
	});
});

describe("buildImageSrcSet", () => {
	it("emits density descriptors by default, with no dpr on 1x", () => {
		expect(buildImageSrcSet(image(), { width: 400, auto: null })).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?w=400 1x, ` +
				`${CDN}/products/5c7b0e7e1802c.jpeg?w=400&dpr=2 2x`,
		);
	});

	it("is null without a width — a density set would repeat one URL", () => {
		expect(buildImageSrcSet(image(), {})).toBeNull();
	});

	it("is null when densities are switched off", () => {
		expect(buildImageSrcSet(image(), { width: 400, densities: [] })).toBeNull();
	});

	it("emits width descriptors when widths are given", () => {
		expect(buildImageSrcSet(image(), { widths: [200, 400], auto: null })).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?w=200 200w, ` +
				`${CDN}/products/5c7b0e7e1802c.jpeg?w=400 400w`,
		);
	});

	it("scales the height with each candidate width, keeping the ratio", () => {
		expect(
			buildImageSrcSet(image(), {
				width: 400,
				height: 200,
				widths: [800],
				auto: null,
			}),
		).toBe(`${CDN}/products/5c7b0e7e1802c.jpeg?w=800&h=400 800w`);
	});

	it("de-duplicates and sorts candidates, and ignores nonsense", () => {
		expect(
			buildImageSrcSet(image(), {
				widths: [400, 200, 400, 0, -1, Number.NaN],
				auto: null,
			}),
		).toBe(
			`${CDN}/products/5c7b0e7e1802c.jpeg?w=200 200w, ` +
				`${CDN}/products/5c7b0e7e1802c.jpeg?w=400 400w`,
		);
	});

	it("is null when there is no image", () => {
		expect(buildImageSrcSet(null, { width: 400 })).toBeNull();
	});
});

describe("applyImageTransform", () => {
	it("returns the url untouched when nothing would be added", () => {
		expect(applyImageTransform("https://x.test/a.jpg", { auto: null })).toBe(
			"https://x.test/a.jpg",
		);
	});

	it("defaults auto=format, which is what the platform's own storefront sends", () => {
		expect(applyImageTransform("https://x.test/a.jpg")).toBe(
			"https://x.test/a.jpg?auto=format",
		);
	});
});
