import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AddToCart,
	ProductOptionValues,
	ProductPrice,
	ProductProvider,
	SelectedVariant,
	useProductState,
} from "../src/react/index.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { Product, ProductVariant } from "../src/sdk/types/catalog.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

const COLOR = 2;
const SIZE = 3;
const RED = 5;
const BLACK = 9;
const L = 6;
const XL = 7;
const XXL = 8;

function variant(
	id: number,
	sku: string,
	color: number,
	size: number,
	price: number,
): ProductVariant {
	const names: Record<number, string> = {
		[RED]: "Red",
		[BLACK]: "Black",
		[L]: "L",
		[XL]: "XL",
		[XXL]: "XXL",
	};
	return {
		id,
		sku,
		barcode: null,
		weight: null,
		hidden: null,
		minPurchaseQty: null,
		maxPurchaseQty: null,
		price: { price, comparePrice: null },
		stock: { stock: null, preorder: null },
		options: [
			{ id: color, name: names[color] ?? null, position: 1, optionId: COLOR },
			{ id: size, name: names[size] ?? null, position: 1, optionId: SIZE },
		],
	};
}

/** `prod_27`: Red has no XXL, and Black/XXL costs ten times as much. */
const PRODUCT: Product = {
	id: "prod_27",
	name: "Complex Product",
	price: 9900,
	description: null,
	slug: "complex-product",
	visible: true,
	taxRate: 25,
	seoTitle: null,
	seoDescription: null,
	images: [],
	options: [
		{ id: COLOR, name: "Color", position: 1 },
		{ id: SIZE, name: "Size", position: 2 },
	],
	variants: [
		variant(5, "Red-L", RED, L, 9900),
		variant(6, "Red-XL", RED, XL, 9900),
		variant(8, "Black-L", BLACK, L, 9900),
		variant(9, "Black-XL", BLACK, XL, 9900),
		variant(10, "Black-XXL", BLACK, XXL, 99900),
	],
};

function makeClient(fetchImpl: typeof globalThis.fetch) {
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

/** A picker built only from the headless pieces — no markup from shopkit. */
function Picker({ product = PRODUCT }: { product?: Product }) {
	return (
		<ProductProvider product={product} currency="SEK">
			<ProductOptionValues option="Color">
				{(value) => (
					<button
						key={value.id}
						type="button"
						data-testid={`color-${value.name}`}
						data-selected={value.selected}
						data-available={value.available}
						onClick={() => undefined}
					>
						{value.name}
					</button>
				)}
			</ProductOptionValues>
			<Colors />
			<Sizes />
			<ProductPrice>
				{(price) => (
					<span data-testid="price">
						{price.amount !== null
							? String(price.amount)
							: price.isRange
								? `from ${price.min}`
								: String(price.min)}
					</span>
				)}
			</ProductPrice>
			<SelectedVariant fallback={<span data-testid="sku">none</span>}>
				{(v) => <span data-testid="sku">{v.sku}</span>}
			</SelectedVariant>
			<AddToCart>
				{({ addToCart, canAddToCart, missingOptions }) => (
					<button
						type="button"
						data-testid="add"
						disabled={!canAddToCart}
						data-missing={missingOptions.map((g) => g.name).join(",")}
						onClick={() => void addToCart()}
					>
						add
					</button>
				)}
			</AddToCart>
		</ProductProvider>
	);
}

/** Clickable colour cards, driven by the context. */
function Colors() {
	const { options, select } = useProductState();
	const group = options.find((g) => g.name === "Color");
	return (
		<div>
			{group?.values.map((value) => (
				<button
					key={value.id}
					type="button"
					data-testid={`pick-color-${value.name}`}
					onClick={() => select(group.id, value.id)}
				>
					{value.name}
				</button>
			))}
		</div>
	);
}

function Sizes() {
	const { options, select } = useProductState();
	const group = options.find((g) => g.name === "Size");
	return (
		<div>
			{group?.values.map((value) => (
				<button
					key={value.id}
					type="button"
					data-testid={`size-${value.name}`}
					data-available={value.available}
					data-selected={value.selected}
					disabled={!value.available}
					onClick={() => select(group.id, value.id)}
				>
					{value.name}
				</button>
			))}
		</div>
	);
}

function click(testId: string) {
	return act(async () => {
		screen.getByTestId(testId).click();
	});
}

function renderPicker(
	fetchImpl = createFakeFetch([]).fetch,
	product = PRODUCT,
) {
	return render(
		<ShopkitProvider client={makeClient(fetchImpl)}>
			<Picker product={product} />
		</ShopkitProvider>,
	);
}

describe("ProductProvider + headless picker", () => {
	it("renders no markup of its own", () => {
		// The provider and the render-prop components must contribute nothing to
		// the DOM — everything visible comes from the app's own elements.
		const { container } = render(
			<ProductProvider product={PRODUCT}>
				<i data-testid="only-child" />
			</ProductProvider>,
		);
		expect(container.innerHTML).toBe('<i data-testid="only-child"></i>');
	});

	it("starts with nothing selected and shows a price range", () => {
		renderPicker();
		expect(screen.getByTestId("price").textContent).toBe("from 9900");
		expect(screen.getByTestId("sku").textContent).toBe("none");
	});

	it("cannot add to cart until a variant is pinned", () => {
		renderPicker();
		const add = screen.getByTestId("add") as HTMLButtonElement;
		expect(add.disabled).toBe(true);
		expect(add.dataset.missing).toBe("Color,Size");
	});

	it("selecting Red narrows the sizes to those Red actually has", async () => {
		renderPicker();

		await click("pick-color-Red");

		expect(screen.getByTestId("size-L").dataset.available).toBe("true");
		expect(screen.getByTestId("size-XL").dataset.available).toBe("true");
		expect(screen.getByTestId("size-XXL").dataset.available).toBe("false");
		expect((screen.getByTestId("size-XXL") as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("selecting Black opens up XXL", async () => {
		renderPicker();

		await click("pick-color-Black");

		expect(screen.getByTestId("size-XXL").dataset.available).toBe("true");
	});

	it("collapses the price range as soon as the colour excludes the outlier", async () => {
		renderPicker();

		await click("pick-color-Red");

		// Still no variant, but every reachable one costs the same now.
		expect(screen.getByTestId("price").textContent).toBe("9900");
	});

	it("shows the exact price when the variant resolves, and updates on change", async () => {
		renderPicker();

		await click("pick-color-Black");
		await click("size-L");
		expect(screen.getByTestId("price").textContent).toBe("9900");
		expect(screen.getByTestId("sku").textContent).toBe("Black-L");

		await click("size-XXL");
		expect(screen.getByTestId("price").textContent).toBe("99900");
		expect(screen.getByTestId("sku").textContent).toBe("Black-XXL");
	});

	it("re-picking a colour that lacks the chosen size clears the size", async () => {
		renderPicker();

		await click("pick-color-Black");
		await click("size-XXL");
		expect(screen.getByTestId("sku").textContent).toBe("Black-XXL");

		await click("pick-color-Red");

		// Red has no XXL: the size is dropped for re-pick rather than dead-ending.
		expect(screen.getByTestId("sku").textContent).toBe("none");
		expect(screen.getByTestId("size-XXL").dataset.available).toBe("false");
		expect(screen.getByTestId("size-L").dataset.selected).toBe("false");
	});

	it("keeps a compatible size when switching colour", async () => {
		renderPicker();

		await click("pick-color-Red");
		await click("size-XL");
		await click("pick-color-Black");

		expect(screen.getByTestId("sku").textContent).toBe("Black-XL");
	});

	it("adds the selected VARIANT to the cart, not just the product", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		renderPicker(fake.fetch);

		await click("pick-color-Black");
		await click("size-XXL");
		expect((screen.getByTestId("add") as HTMLButtonElement).disabled).toBe(
			false,
		);
		await click("add");

		await waitFor(() => expect(fake.calls.length).toBe(2));
		expect(fake.calls[1]?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 1,
		});
	});

	it("notifies on variant change, including back to null", async () => {
		const onVariantChange = vi.fn();
		render(
			<ShopkitProvider client={makeClient(createFakeFetch([]).fetch)}>
				<ProductProvider product={PRODUCT} onVariantChange={onVariantChange}>
					<Colors />
					<Sizes />
				</ProductProvider>
			</ShopkitProvider>,
		);

		await click("pick-color-Black");
		await click("size-XXL");
		await waitFor(() =>
			expect(onVariantChange).toHaveBeenCalledWith(
				expect.objectContaining({ sku: "Black-XXL" }),
			),
		);

		await click("pick-color-Red");
		await waitFor(() => expect(onVariantChange).toHaveBeenLastCalledWith(null));
	});

	it("preselects a variant when asked", () => {
		render(
			<ShopkitProvider client={makeClient(createFakeFetch([]).fetch)}>
				<ProductProvider product={PRODUCT} initialVariantId={10}>
					<SelectedVariant fallback={<span data-testid="sku">none</span>}>
						{(v) => <span data-testid="sku">{v.sku}</span>}
					</SelectedVariant>
				</ProductProvider>
			</ShopkitProvider>,
		);
		expect(screen.getByTestId("sku").textContent).toBe("Black-XXL");
	});

	it("treats a product with no options as immediately complete", () => {
		const simple: Product = {
			...PRODUCT,
			id: "prod_1",
			options: [],
			variants: [{ ...variant(1, "simple", RED, L, 28700), options: [] }],
		};
		renderPicker(createFakeFetch([]).fetch, simple);

		expect(screen.getByTestId("sku").textContent).toBe("simple");
		expect((screen.getByTestId("add") as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(screen.getByTestId("price").textContent).toBe("28700");
	});

	it("resets the selection when a different product is rendered in the slot", async () => {
		const { rerender } = render(
			<ShopkitProvider client={makeClient(createFakeFetch([]).fetch)}>
				<ProductProvider product={PRODUCT}>
					<Colors />
					<SelectedVariant fallback={<span data-testid="sku">none</span>}>
						{(v) => <span data-testid="sku">{v.sku}</span>}
					</SelectedVariant>
				</ProductProvider>
			</ShopkitProvider>,
		);
		await click("pick-color-Black");

		const other: Product = {
			...PRODUCT,
			id: "prod_28",
			variants: PRODUCT.variants,
		};
		rerender(
			<ShopkitProvider client={makeClient(createFakeFetch([]).fetch)}>
				<ProductProvider product={other}>
					<Colors />
					<SelectedVariant fallback={<span data-testid="sku">none</span>}>
						{(v) => <span data-testid="sku">{v.sku}</span>}
					</SelectedVariant>
				</ProductProvider>
			</ShopkitProvider>,
		);

		// A stale selection would carry foreign option ids into the new product.
		expect(screen.getByTestId("sku").textContent).toBe("none");
	});

	it("fails with a named error outside a ProductProvider", () => {
		function Orphan() {
			useProductState();
			return null;
		}
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => render(<Orphan />)).toThrow(/ProductProvider/);
		spy.mockRestore();
	});
});
