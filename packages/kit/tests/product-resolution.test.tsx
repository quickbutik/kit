import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { clearProductCache } from "../src/index.js";
import {
	ProductProvider,
	SEO,
	SeoProvider,
	useProductState,
} from "../src/react/index.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient, type ShopkitClient } from "../src/sdk/client.js";
import type { Product } from "../src/sdk/types/catalog.js";
import type { Shop } from "../src/sdk/types/shop.js";
import { createFakeFetch, TEST_KEY } from "./helpers.js";

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
	images: [],
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

const page = (products: Product[]) => ({
	data: products,
	has_more: false,
	next_cursor: null,
});

function makeClient(fetchImpl: typeof globalThis.fetch): ShopkitClient {
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
	});
}

/** Prints the resolved product's name, or nothing when there is no provider. */
function Name() {
	return <span data-testid="name">{useProductState().product.name}</span>;
}

function tree(client: ShopkitClient, ui: React.ReactNode) {
	return (
		<ShopkitProvider client={client}>
			<Suspense fallback={<span data-testid="loading">loading</span>}>
				{ui}
			</Suspense>
		</ShopkitProvider>
	);
}

/** Render without waiting — for asserting the Suspense fallback. */
function wrap(client: ShopkitClient, ui: React.ReactNode) {
	return render(tree(client, ui));
}

/**
 * Render and let the suspense settle.
 *
 * `render()` wraps in a SYNCHRONOUS `act()`, and React refuses to resume a tree
 * that suspended inside an un-awaited act — the fallback would stay forever and
 * the failure looks like a broken component. Anything that suspends has to be
 * rendered inside an awaited `act`.
 */
async function wrapResolved(client: ShopkitClient, ui: React.ReactNode) {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(tree(client, ui));
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned synchronously inside act.
	return result!;
}

describe("<ProductProvider> resolution", () => {
	it("accepts a resolved product, with no request", () => {
		const fake = createFakeFetch([]);
		wrap(
			makeClient(fake.fetch),
			<ProductProvider product={PRODUCT}>{<Name />}</ProductProvider>,
		);

		expect(screen.getByTestId("name").textContent).toBe("Complex Product");
		expect(fake.calls).toHaveLength(0);
	});

	it("unwraps a promise with Suspense, showing the fallback first", async () => {
		// The React 19 server→client idiom: a server component starts the fetch
		// without awaiting and hands the promise down.
		let settle: ((value: Product) => void) | undefined;
		const promise = new Promise<Product>((resolve) => {
			settle = resolve;
		});
		// Rendered inside an awaited act, but with a promise that has NOT settled —
		// so the fallback is what is on screen when act returns.
		await wrapResolved(
			makeClient(createFakeFetch([]).fetch),
			<ProductProvider product={promise}>{<Name />}</ProductProvider>,
		);

		expect(screen.getByTestId("loading")).toBeTruthy();
		expect(screen.queryByTestId("name")).toBeNull();

		await act(async () => {
			settle?.(PRODUCT);
		});

		expect(screen.getByTestId("name").textContent).toBe("Complex Product");
	});

	it("looks a product up by slug", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT]) },
		]);
		await wrapResolved(
			makeClient(fake.fetch),
			<ProductProvider slug="complex-product">{<Name />}</ProductProvider>,
		);

		expect(screen.getByTestId("name").textContent).toBe("Complex Product");
	});

	it("looks a product up by id", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
		]);
		await wrapResolved(
			makeClient(fake.fetch),
			<ProductProvider id="prod_27">{<Name />}</ProductProvider>,
		);

		expect(screen.getByTestId("name").textContent).toBe("Complex Product");
		expect(fake.calls).toHaveLength(1);
	});

	it("requests the lookup only once across re-renders", async () => {
		// Without a cached promise, `use()` would suspend on a new promise every
		// render and never settle. One request is the observable proof.
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT]) },
		]);
		const client = makeClient(fake.fetch);
		const { rerender } = await wrapResolved(
			client,
			<ProductProvider slug="complex-product">{<Name />}</ProductProvider>,
		);
		expect(screen.getByTestId("name")).toBeTruthy();

		await act(async () => {
			rerender(
				tree(
					client,
					<ProductProvider slug="complex-product">{<Name />}</ProductProvider>,
				),
			);
		});

		expect(screen.getByTestId("name")).toBeTruthy();
		expect(fake.calls).toHaveLength(1);
		clearProductCache(client);
	});

	it("renders `notFound` when the slug matches nothing", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([]) },
		]);
		await wrapResolved(
			makeClient(fake.fetch),
			<ProductProvider
				slug="ghost"
				notFound={<span data-testid="missing">nope</span>}
			>
				<Name />
			</ProductProvider>,
		);

		expect(screen.getByTestId("missing")).toBeTruthy();
		expect(screen.queryByTestId("name")).toBeNull();
	});

	it("renders nothing when a missing product has no `notFound`", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_9", status: 404, body: {} },
		]);
		const { container } = await wrapResolved(
			makeClient(fake.fetch),
			<ProductProvider id="prod_9">{<Name />}</ProductProvider>,
		);

		expect(container.textContent).toBe("");
	});

	it("explains itself when given neither a product nor a lookup", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() =>
			render(
				<ShopkitProvider client={makeClient(createFakeFetch([]).fetch)}>
					<ProductProvider>{<Name />}</ProductProvider>
				</ShopkitProvider>,
			),
		).toThrow(/needs a `product`, a `slug` or an `id`/);
		spy.mockRestore();
	});

	it("explains itself when a lookup has no ShopkitProvider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() =>
			render(<ProductProvider slug="x">{<Name />}</ProductProvider>),
		).toThrow(/needs a <ShopkitProvider>/);
		spy.mockRestore();
	});

	it("still works with a resolved product and no ShopkitProvider at all", () => {
		// The object path must not require a client — a statically generated page
		// may have no provider above it.
		render(<ProductProvider product={PRODUCT}>{<Name />}</ProductProvider>);
		expect(screen.getByTestId("name").textContent).toBe("Complex Product");
	});
});

describe("<SEO /> inside a product context", () => {
	function metaContent(container: HTMLElement, selector: string) {
		const node =
			container.querySelector(selector) ??
			document.head.querySelector(selector);
		return node?.getAttribute("content") ?? null;
	}

	it("takes the product, currency and canonical without any props", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page([PRODUCT]) },
		]);
		let rendered: ReturnType<typeof render> | undefined;
		await act(async () => {
			rendered = render(
				<ShopkitProvider client={makeClient(fake.fetch)}>
					<SeoProvider
						baseUrl="https://myshop.test"
						shop={SHOP}
						currency="SEK"
						productPath="/products/{slug}"
					>
						<Suspense fallback={null}>
							<ProductProvider slug="complex-product">
								<SEO />
							</ProductProvider>
						</Suspense>
					</SeoProvider>
				</ShopkitProvider>,
			);
		});
		// biome-ignore lint/style/noNonNullAssertion: assigned synchronously inside act.
		const { container } = rendered!;

		expect(metaContent(container, 'meta[property="og:type"]')).toBe("product");
		// Title from the product, price from the provider's currency, canonical
		// from the productPath template — none of it passed to <SEO />.
		const canonical =
			container.querySelector('link[rel="canonical"]') ??
			document.head.querySelector('link[rel="canonical"]');
		expect(canonical?.getAttribute("href")).toBe(
			"https://myshop.test/products/complex-product",
		);
		expect(metaContent(container, 'meta[property="og:title"]')).toBe(
			"Complex Product",
		);
		expect(
			metaContent(container, 'meta[property="product:price:amount"]'),
		).toBe("99.00");
	});

	it("lets an explicit prop override the context", () => {
		const { container } = render(
			<SeoProvider baseUrl="https://myshop.test" shop={SHOP}>
				<ProductProvider product={PRODUCT}>
					<SEO title="Something else" />
				</ProductProvider>
			</SeoProvider>,
		);
		expect(metaContent(container, 'meta[property="og:title"]')).toBe(
			"Something else",
		);
	});

	it("falls back to the product id when the template needs a slug it lacks", () => {
		const { container } = render(
			<SeoProvider baseUrl="https://myshop.test" productPath="/products/{slug}">
				<ProductProvider product={{ ...PRODUCT, slug: null }}>
					<SEO />
				</ProductProvider>
			</SeoProvider>,
		);
		// No slug and the template needs one → no canonical, rather than a URL
		// with a literal `{slug}` in it.
		expect(
			container.querySelector('link[rel="canonical"]') ??
				document.head.querySelector('link[rel="canonical"]'),
		).toBeNull();
	});
});
