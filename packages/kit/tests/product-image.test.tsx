import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { ProductImage, ProductProvider } from "../src/react/index.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient, type ShopkitClient } from "../src/sdk/client.js";
import type {
	Product,
	ProductImage as ProductImageRecord,
} from "../src/sdk/types/catalog.js";
import { clearProductCache } from "../src/state/product-cache.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

const CDN = "https://cdn.quickbutik.com/images/ABC1";

function imageRecord(
	overrides: Partial<ProductImageRecord> = {},
): ProductImageRecord {
	return {
		id: 1,
		productId: 27,
		url: `${CDN}/products/main.jpeg`,
		path: "main.jpeg",
		position: 1,
		date: null,
		altText: null,
		contentHash: null,
		...overrides,
	};
}

function makeProduct(overrides: Partial<Product> = {}): Product {
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
		images: [imageRecord()],
		options: [],
		variants: [],
		...overrides,
	};
}

function makeClient(
	fetchImpl: typeof globalThis.fetch,
	imageBaseUrl?: string,
): ShopkitClient {
	return createShopkitClient({
		// Consent and analytics are on by default under <ShopkitProvider>; this
		// suite tests the shop surfaces as they are without them (they have their
		// own suites), so its clients opt out.
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		imageBaseUrl,
	});
}

function img(): HTMLImageElement {
	return screen.getByTestId("img") as HTMLImageElement;
}

/** `src` as written, not as the DOM resolves it (happy-dom absolutises). */
function srcAttr(): string | null {
	return img().getAttribute("src");
}

describe("<ProductImage> — the image source", () => {
	it("renders the absolute CDN url, never the bare filename", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				width={600}
				height={600}
			/>,
		);
		expect(srcAttr()).toBe(`${CDN}/products/main.jpeg?auto=format&w=600&h=600`);
	});

	it("renders the fallback — not a broken img — when only a filename came back", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct({ images: [imageRecord({ url: null })] })}
				fallback={<span data-testid="empty">no image</span>}
			/>,
		);
		expect(screen.queryByTestId("img")).toBeNull();
		expect(screen.getByTestId("empty")).toBeTruthy();
	});

	it("completes a bare filename from the client's imageBaseUrl", () => {
		const client = makeClient(createFakeFetch([]).fetch, CDN);
		render(
			<ShopkitProvider client={client}>
				<ProductImage
					data-testid="img"
					product={makeProduct({ images: [imageRecord({ url: null })] })}
					width={100}
				/>
			</ShopkitProvider>,
		);
		expect(srcAttr()).toBe(`${CDN}/products/main.jpeg?auto=format&w=100`);
	});

	it("renders nothing at all for a product with no images and no fallback", () => {
		const { container } = render(
			<ProductImage data-testid="img" product={makeProduct({ images: [] })} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("skips an image whose file is still processing", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct({
					images: [
						imageRecord({ id: 1, position: 1, contentHash: "temp" }),
						imageRecord({
							id: 2,
							position: 2,
							url: `${CDN}/products/second.jpeg`,
						}),
					],
				})}
			/>,
		);
		expect(srcAttr()).toContain("second.jpeg");
	});
});

describe("<ProductImage> — choosing the image", () => {
	const product = makeProduct({
		images: [
			imageRecord({ id: 1, position: 2, url: `${CDN}/products/b.jpeg` }),
			imageRecord({ id: 2, position: 1, url: `${CDN}/products/a.jpeg` }),
		],
	});

	it("defaults to the main image in display order", () => {
		render(<ProductImage data-testid="img" product={product} />);
		expect(srcAttr()).toContain("a.jpeg");
	});

	it("takes an index", () => {
		render(<ProductImage data-testid="img" product={product} index={1} />);
		expect(srcAttr()).toContain("b.jpeg");
	});

	it("takes an image id", () => {
		render(<ProductImage data-testid="img" product={product} imageId={1} />);
		expect(srcAttr()).toContain("b.jpeg");
	});

	it("takes an image record directly, with no product at all", () => {
		render(
			<ProductImage
				data-testid="img"
				image={imageRecord({ url: `${CDN}/products/direct.jpeg` })}
			/>,
		);
		expect(srcAttr()).toContain("direct.jpeg");
	});
});

describe("<ProductImage> — alt text", () => {
	it("prefers the image's own alt text", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct({ images: [imageRecord({ altText: "Side on" })] })}
			/>,
		);
		expect(img().alt).toBe("Side on");
	});

	it("falls back to the product name", () => {
		render(<ProductImage data-testid="img" product={makeProduct()} />);
		expect(img().alt).toBe("Sneakers");
	});

	it("honours an explicit empty alt for a decorative image", () => {
		render(<ProductImage data-testid="img" product={makeProduct()} alt="" />);
		expect(img().alt).toBe("");
	});
});

describe("<ProductImage> — img attributes", () => {
	it("emits a 1x/2x srcSet from the width", () => {
		render(
			<ProductImage data-testid="img" product={makeProduct()} width={400} />,
		);
		expect(img().getAttribute("srcset")).toBe(
			`${CDN}/products/main.jpeg?auto=format&w=400 1x, ` +
				`${CDN}/products/main.jpeg?auto=format&w=400&dpr=2 2x`,
		);
	});

	it("emits width descriptors and passes `sizes` through", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				widths={[400, 800]}
				sizes="(min-width: 60rem) 33vw, 100vw"
			/>,
		);
		expect(img().getAttribute("srcset")).toBe(
			`${CDN}/products/main.jpeg?auto=format&w=400 400w, ` +
				`${CDN}/products/main.jpeg?auto=format&w=800 800w`,
		);
		expect(img().getAttribute("sizes")).toBe("(min-width: 60rem) 33vw, 100vw");
	});

	it("omits srcSet when densities are switched off", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				width={400}
				densities={[]}
			/>,
		);
		expect(img().hasAttribute("srcset")).toBe(false);
	});

	it("lazy-loads by default and reserves the layout box", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				width={300}
				height={200}
			/>,
		);
		expect(img().getAttribute("loading")).toBe("lazy");
		expect(img().getAttribute("decoding")).toBe("async");
		expect(img().getAttribute("width")).toBe("300");
		expect(img().getAttribute("height")).toBe("200");
	});

	it("loads eagerly at high priority for the LCP image", () => {
		render(<ProductImage data-testid="img" product={makeProduct()} priority />);
		expect(img().getAttribute("loading")).toBe("eager");
		expect(img().getAttribute("fetchpriority")).toBe("high");
	});

	it("passes className and style through to the img", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				className="thumb"
				style={{ borderRadius: 8 }}
			/>,
		);
		expect(img().className).toBe("thumb");
		expect(img().style.borderRadius).toBe("8px");
	});

	it("applies the transform options", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				width={200}
				densities={[1]}
				transform={{ quality: 60, format: "webp", fit: "crop" }}
			/>,
		);
		expect(srcAttr()).toBe(
			`${CDN}/products/main.jpeg?auto=format&w=200&q=60&fm=webp&fit=crop`,
		);
	});

	it("takes a size from the transform when no width/height prop is given", () => {
		// Regression guard: an absent width prop must not override
		// `transform.width` with undefined.
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				densities={[1]}
				transform={{ width: 300, height: 150 }}
			/>,
		);
		expect(srcAttr()).toBe(`${CDN}/products/main.jpeg?auto=format&w=300&h=150`);
		expect(img().getAttribute("width")).toBe("300");
		expect(img().getAttribute("height")).toBe("150");
	});

	it("lets an explicit width prop win over the transform", () => {
		render(
			<ProductImage
				data-testid="img"
				product={makeProduct()}
				width={200}
				densities={[1]}
				transform={{ width: 300 }}
			/>,
		);
		expect(srcAttr()).toBe(`${CDN}/products/main.jpeg?auto=format&w=200`);
	});
});

describe("<ProductImage> — the product context", () => {
	it("takes the product from a surrounding <ProductProvider>", () => {
		render(
			<ProductProvider product={makeProduct()}>
				<ProductImage data-testid="img" width={800} />
			</ProductProvider>,
		);
		expect(srcAttr()).toContain("main.jpeg");
		expect(img().alt).toBe("Sneakers");
	});

	it("does not re-fetch when the productId names the context product", () => {
		const fake = createFakeFetch([]);
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={makeProduct()}>
					<ProductImage data-testid="img" productId="prod_27" />
				</ProductProvider>
			</ShopkitProvider>,
		);
		expect(srcAttr()).toContain("main.jpeg");
		expect(fake.calls).toHaveLength(0);
	});

	it("matches a raw numeric id against the prefixed one", () => {
		const fake = createFakeFetch([]);
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={makeProduct()}>
					<ProductImage data-testid="img" productId={27} />
				</ProductProvider>
			</ShopkitProvider>,
		);
		expect(fake.calls).toHaveLength(0);
	});

	it("explains itself when there is nothing to resolve a product from", () => {
		expect(() => render(<ProductImage data-testid="img" />)).toThrow(
			/needs a `productId`, a `slug`, a `product` or an `image`/,
		);
	});

	it("explains itself when a productId is given with no client", () => {
		expect(() =>
			render(<ProductImage data-testid="img" productId="prod_9" />),
		).toThrow(/no <ShopkitProvider>/);
	});
});

describe("<ProductImage> — fetching by id", () => {
	it("loads the product and renders its image", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products/prod_27",
				body: makeProduct({
					images: [imageRecord({ url: `${CDN}/products/fetched.jpeg` })],
				}),
			},
		]);
		const client = makeClient(fake.fetch);
		clearProductCache(client);

		await act(async () => {
			render(
				<ShopkitProvider client={client}>
					<Suspense fallback={<span data-testid="loading">…</span>}>
						<ProductImage data-testid="img" productId="prod_27" width={64} />
					</Suspense>
				</ShopkitProvider>,
			);
		});

		expect(srcAttr()).toContain("fetched.jpeg");
		expect(fake.calls).toHaveLength(1);
	});

	it("renders the fallback for a product that does not exist", async () => {
		const fake = createFakeFetch([
			// A raw numeric `productId` is prefixed before it leaves the SDK — the
			// gateway 400s a bare id. See ProductsResource.get().
			{ match: "GET /v2/products/prod_999", status: 404, body: {} },
		]);
		const client = makeClient(fake.fetch);
		clearProductCache(client);

		await act(async () => {
			render(
				<ShopkitProvider client={client}>
					<Suspense fallback={<span data-testid="loading">…</span>}>
						<ProductImage
							data-testid="img"
							productId={999}
							fallback={<span data-testid="empty">gone</span>}
						/>
					</Suspense>
				</ShopkitProvider>,
			);
		});

		expect(screen.getByTestId("empty")).toBeTruthy();
	});
});
