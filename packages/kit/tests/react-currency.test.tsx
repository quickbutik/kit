import { act, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import {
	ProductProvider,
	useProductPrice,
} from "../src/react/product-context.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { useCart } from "../src/react/use-cart.js";
import { useProducts } from "../src/react/use-catalog.js";
import { useCurrency } from "../src/react/use-currency.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { ShopkitConfig } from "../src/sdk/config.js";
import { PRODUCT as VARIANT_PRODUCT } from "./elements/helpers.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

const SHOP = {
	name: "Shop",
	brand: { logo: null, color: { primary: null } },
	currency: "SEK",
	currencies: [
		{ code: "SEK", mode: "base", rate: 1 },
		{ code: "EUR", mode: "charge", rate: 0.0871 },
		{ code: "NOK", mode: "display", rate: 0.95 },
	],
};

const PRODUCT = {
	id: "prod_27",
	name: "Tee",
	slug: "tee",
	price: 9900,
	currency: "SEK",
	description: null,
	visible: true,
	taxRate: 25,
	seoTitle: null,
	seoDescription: null,
	images: [],
	variants: [],
};

function page(product: Record<string, unknown>) {
	return { data: [product], has_more: false, next_cursor: null };
}

function sentCurrency(url: string): string | null {
	return new URL(url).searchParams.get("currency");
}

function config(
	fetchImpl: typeof globalThis.fetch,
	overrides: Partial<ShopkitConfig> = {},
): ShopkitConfig {
	return {
		// Consent and analytics are on by default; this suite tests currencies
		// without them (they have their own suites), and the analytics hub's
		// shop read would take the fake fetch's shop route.
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		...overrides,
	};
}

function Switcher() {
	const { currency, currencies, mode, chargeCurrency, setCurrency, isLoading } =
		useCurrency();
	if (isLoading) return <p>loading currencies</p>;
	return (
		<div>
			<p data-testid="currency">
				{currency}/{mode}/{chargeCurrency}
			</p>
			{currencies.map((entry) => (
				<button
					key={entry.code}
					type="button"
					onClick={() => void setCurrency(entry.code)}
				>
					{entry.code}
				</button>
			))}
		</div>
	);
}

function Grid() {
	const { data } = useProducts();
	const product = data?.data[0];
	return (
		<p data-testid="grid">
			{product ? `${product.price} ${product.currency}` : "…"}
		</p>
	);
}

function Basket() {
	const { cart } = useCart();
	return (
		<p data-testid="cart">{cart ? `${cart.total} ${cart.currency}` : "none"}</p>
	);
}

describe("useCurrency", () => {
	it("lists the shop's currencies and switches, refetching the catalog and the cart", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
			{ match: "GET /v2/products", body: page(PRODUCT) },
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ total: 9900 }) },
			{
				match: "GET /v2/products",
				body: page({ ...PRODUCT, price: 862, currency: "EUR" }),
			},
			{
				match: "GET /v2/cart/cart-1",
				body: cartEnvelope({ total: 862, currency: "EUR" }),
			},
		]);

		render(
			<ShopkitProvider config={config(fake.fetch, { storage })}>
				<Switcher />
				<Grid />
				<Basket />
			</ShopkitProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("currency").textContent).toBe("SEK/base/SEK"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("grid").textContent).toBe("9900 SEK"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("cart").textContent).toBe("9900 SEK"),
		);

		await act(async () => {
			screen.getByText("EUR").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("currency").textContent).toBe("EUR/charge/EUR"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("grid").textContent).toBe("862 EUR"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("cart").textContent).toBe("862 EUR"),
		);

		const reads = fake.calls.filter((call) => call.method === "GET");
		const productReads = reads.filter((call) =>
			new URL(call.url).pathname.endsWith("/products"),
		);
		expect(productReads.map((call) => sentCurrency(call.url))).toEqual([
			null,
			"EUR",
		]);
		const cartReads = reads.filter((call) => call.url.includes("/cart/"));
		expect(cartReads.map((call) => sentCurrency(call.url))).toEqual([
			null,
			"EUR",
		]);
		// One shop read, however many times the hook rendered.
		expect(
			reads.filter((call) => call.url.includes("/checkout/shop")),
		).toHaveLength(1);
		expect(await storage.get("qb_currency")).toBe("EUR");
	});

	it("reports a display currency as charged in the shop's currency", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/checkout/shop", body: SHOP },
		]);
		render(
			<ShopkitProvider config={config(fake.fetch, { currency: "nok" })}>
				<Switcher />
			</ShopkitProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("currency").textContent).toBe(
				"NOK/display/SEK",
			),
		);
	});
});

describe("<ShopkitProvider currency>", () => {
	it("is the client's default, and a later change switches without a new client", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page(PRODUCT) },
			{
				match: "GET /v2/products",
				body: page({ ...PRODUCT, currency: "NOK" }),
			},
		]);
		const cfg = config(fake.fetch);
		const { rerender } = render(
			<ShopkitProvider config={cfg} currency="EUR">
				<Grid />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(fake.calls).toHaveLength(1));
		expect(sentCurrency(fake.calls[0]?.url ?? "")).toBe("EUR");

		rerender(
			<ShopkitProvider config={cfg} currency="NOK">
				<Grid />
			</ShopkitProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("grid").textContent).toBe("9900 NOK"),
		);
		expect(sentCurrency(fake.calls[1]?.url ?? "")).toBe("NOK");
	});
});

describe("ProductProvider and currency", () => {
	function Price() {
		const { min, currency } = useProductPrice();
		return (
			<p data-testid="price">
				{min} {currency}
			</p>
		);
	}

	it("reports the product's own currency over the prop", () => {
		render(
			<ProductProvider
				product={{ ...VARIANT_PRODUCT, currency: "EUR" }}
				currency="SEK"
			>
				<Price />
			</ProductProvider>,
		);
		expect(screen.getByTestId("price").textContent).toMatch(/^\d+ EUR$/);
	});

	it("re-resolves a lookup by id when the currency changes", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/prod_27", body: PRODUCT },
			{
				match: "GET /v2/products/prod_27",
				body: { ...PRODUCT, price: 862, currency: "EUR" },
			},
		]);
		const client = createShopkitClient(config(fake.fetch));
		// Rendered inside an awaited act: React will not resume a tree that
		// suspended inside the synchronous act `render()` uses.
		await act(async () => {
			render(
				<ShopkitProvider client={client}>
					<Suspense fallback={<p>loading</p>}>
						<ProductProvider id={27}>
							<Price />
						</ProductProvider>
					</Suspense>
				</ShopkitProvider>,
			);
		});
		await waitFor(() =>
			expect(screen.getByTestId("price").textContent).toBe("9900 SEK"),
		);
		await act(async () => {
			await client.setCurrency("EUR");
		});
		await waitFor(() =>
			expect(screen.getByTestId("price").textContent).toBe("862 EUR"),
		);
		expect(sentCurrency(fake.calls[1]?.url ?? "")).toBe("EUR");
	});
});
