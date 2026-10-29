import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopkitContextValue } from "../src/react/context.js";
import {
	ProductProvider,
	useCart,
	useCheckout,
	useProductAddToCart,
	useShopkitContext,
} from "../src/react/index.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import type { Product } from "../src/sdk/types/catalog.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

const SF_ID = "sf_01JBQ8ZK4M7XW9YR2TCVN3H5PD";
const OTHER_SF_ID = "sf_01HZY7Q3N9M2K4P6R8T0V1W3X5";

const HANDOFF = {
	sessionId: "sess-1",
	cartId: "cart-1",
	successUrl: "https://myshop.test/order",
	cancelUrl: null,
	backUrl: null,
	language: null,
	origin: null,
	fields: {},
	data: {},
	checkout: "v2",
	hostedUrl: "https://checkout.test/checkout/42/sess-1",
};

const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
});

function buyNowRoutes(): FakeRoute[] {
	return [
		{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
		{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		{
			match: "PATCH /v2/checkout/sessions/sess-1",
			body: { fields: {}, data: {} },
		},
	];
}

function makeClient(fetchImpl: typeof globalThis.fetch, storefrontId?: string) {
	return createShopkitClient({
		// Consent and analytics are on by default under <ShopkitProvider>; this
		// suite tests the shop surfaces as they are without them (they have their
		// own suites), so its clients opt out.
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
		storefrontId,
	});
}

/** A simple product, and one whose Size must be chosen first. */
const SIMPLE: Product = {
	id: "prod_1",
	name: "Mug",
	price: 9900,
	description: null,
	slug: "mug",
	visible: true,
	taxRate: 25,
	seoTitle: null,
	seoDescription: null,
	images: [],
	options: [],
	variants: [],
};

const SIZED: Product = {
	...SIMPLE,
	id: "prod_27",
	options: [{ id: 3, name: "Size", position: 1 }],
	variants: [
		{
			id: 10,
			sku: "L",
			barcode: null,
			weight: null,
			hidden: null,
			minPurchaseQty: null,
			maxPurchaseQty: null,
			price: { price: 9900, comparePrice: null },
			stock: { stock: null, preorder: null },
			options: [{ id: 6, name: "L", position: 1, optionId: 3 }],
		},
	],
};

/** The back button bringing the page back from the back/forward cache. */
function restoreFromBfcache(): void {
	window.dispatchEvent(
		Object.assign(new Event("pageshow"), { persisted: true }),
	);
}

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
	assign = vi.fn();
	vi.spyOn(window.location, "assign").mockImplementation(
		assign as unknown as (url: string | URL) => void,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useCheckout().buyNow", () => {
	it("adds, starts the checkout, navigates, and keeps the cart store in step", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		let count = -1;
		function Button() {
			const { buyNow, starting } = useCheckout();
			const { itemCount } = useCart();
			count = itemCount;
			return (
				<button
					type="button"
					data-testid="buy"
					disabled={starting}
					onClick={() =>
						void buyNow(
							{ productId: "prod_27", variantId: 10 },
							{ successUrl: "https://myshop.test/order" },
						)
					}
				>
					Köp nu
				</button>
			);
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Button />
			</ShopkitProvider>,
		);

		await act(async () => {
			screen.getByTestId("buy").click();
		});

		await waitFor(() =>
			expect(assign).toHaveBeenCalledWith(
				"https://checkout.test/checkout/42/sess-1",
			),
		);
		// The badge saw the add, with no second read of the cart.
		expect(count).toBe(1);
	});

	it("ignores a second click while the first is in flight", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		let buy: ReturnType<typeof useCheckout>["buyNow"] | null = null;
		function Probe() {
			buy = useCheckout().buyNow;
			return null;
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Probe />
			</ShopkitProvider>,
		);

		await act(async () => {
			const input = { successUrl: "https://myshop.test/order" };
			await Promise.all([
				buy?.({ productId: "prod_27" }, input),
				buy?.({ productId: "prod_27" }, input),
			]);
		});

		expect(fake.calls.filter((c) => c.url.endsWith("/items")).length).toBe(1);
		expect(assign).toHaveBeenCalledTimes(1);
	});

	it("stays guarded after navigating, until the page is restored from the bfcache", async () => {
		// A cross-origin navigation takes a while to commit; a guard released as
		// soon as `assign()` returns would let a second click add the item again.
		const fake = createFakeFetch([
			...buyNowRoutes(),
			...buyNowRoutes(),
			// The second buy reads the remembered cart before adding to it.
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
		]);
		const seen: { state: ReturnType<typeof useCheckout> | null } = {
			state: null,
		};
		function Probe() {
			seen.state = useCheckout();
			return null;
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Probe />
			</ShopkitProvider>,
		);
		const input = { successUrl: "https://myshop.test/order" };
		const adds = () =>
			fake.calls.filter((c) => c.url.endsWith("/items")).length;

		await act(async () => {
			await seen.state?.buyNow({ productId: "prod_27" }, input);
		});
		expect(assign).toHaveBeenCalledTimes(1);
		expect(seen.state?.starting).toBe(true);

		await act(async () => {
			await seen.state?.buyNow({ productId: "prod_27" }, input);
		});
		expect(adds()).toBe(1);

		// A plain `pageshow` (a fresh load) is not a restore.
		act(() => {
			window.dispatchEvent(new Event("pageshow"));
		});
		expect(seen.state?.starting).toBe(true);

		act(() => restoreFromBfcache());
		expect(seen.state?.starting).toBe(false);

		await act(async () => {
			await seen.state?.buyNow({ productId: "prod_27" }, input);
		});
		expect(adds()).toBe(2);
		expect(assign).toHaveBeenCalledTimes(2);
		act(() => restoreFromBfcache());
	});

	it("holds redirectToCheckout the same way", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
			{
				match: "PATCH /v2/checkout/sessions/sess-1",
				body: { fields: {}, data: {} },
			},
		]);
		const seen: { state: ReturnType<typeof useCheckout> | null } = {
			state: null,
		};
		function Probe() {
			seen.state = useCheckout();
			return null;
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Probe />
			</ShopkitProvider>,
		);
		const input = { successUrl: "https://myshop.test/order" };

		await act(async () => {
			await seen.state?.redirectToCheckout(input);
		});
		expect(assign).toHaveBeenCalledTimes(1);
		expect(seen.state?.starting).toBe(true);
		await act(async () => {
			expect(await seen.state?.start(input)).toBeNull();
		});

		act(() => restoreFromBfcache());
		expect(seen.state?.starting).toBe(false);
	});

	it("surfaces a failure on `error` and does not navigate", async () => {
		const fake = createFakeFetch([]);
		const seen: { state: ReturnType<typeof useCheckout> | null } = {
			state: null,
		};
		function Probe() {
			seen.state = useCheckout();
			return null;
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Probe />
			</ShopkitProvider>,
		);

		await act(async () => {
			await seen.state?.buyNow({ productId: "prod_27" }, {});
		});

		expect(seen.state?.error).toBeInstanceOf(ShopkitConfigError);
		expect(assign).not.toHaveBeenCalled();
	});
});

describe("useProductAddToCart().buyNow", () => {
	function BuyButton({ quantity }: { quantity?: number }) {
		const { buyNow, buying, canAddToCart } = useProductAddToCart();
		return (
			<button
				type="button"
				data-testid="buy"
				data-buying={buying}
				data-can={canAddToCart}
				onClick={() =>
					void buyNow({ successUrl: "https://myshop.test/order" }, quantity)
				}
			>
				Köp nu
			</button>
		);
	}

	it("buys the selected variant", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={SIZED} initialVariantId={10}>
					<BuyButton quantity={2} />
				</ProductProvider>
			</ShopkitProvider>,
		);

		await act(async () => {
			screen.getByTestId("buy").click();
		});
		await waitFor(() => expect(assign).toHaveBeenCalled());

		const add = fake.calls.find((c) => c.url.endsWith("/items"));
		expect(add?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 2,
		});
	});

	it("is a no-op while the selection is incomplete", async () => {
		const fake = createFakeFetch([]);
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={SIZED}>
					<BuyButton />
				</ProductProvider>
			</ShopkitProvider>,
		);

		expect(screen.getByTestId("buy").dataset.can).toBe("false");
		await act(async () => {
			screen.getByTestId("buy").click();
		});

		expect(fake.calls).toHaveLength(0);
		expect(assign).not.toHaveBeenCalled();
	});

	it("buys a simple product with no variant", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={SIMPLE}>
					<BuyButton />
				</ProductProvider>
			</ShopkitProvider>,
		);

		await act(async () => {
			screen.getByTestId("buy").click();
		});
		await waitFor(() => expect(assign).toHaveBeenCalled());
		expect(fake.calls.find((c) => c.url.endsWith("/items"))?.body).toEqual({
			productId: "prod_1",
			quantity: 1,
		});
	});

	it("buys with the shopper's product-field input", async () => {
		const fake = createFakeFetch(buyNowRoutes());
		function NamedBuyButton() {
			const { buyNow } = useProductAddToCart();
			return (
				<button
					type="button"
					data-testid="buy"
					onClick={() =>
						void buyNow({ successUrl: "https://myshop.test/order" }, 1, [
							{ propertyId: 12, value: "Anna" },
						])
					}
				>
					Köp nu
				</button>
			);
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={SIZED} initialVariantId={10}>
					<NamedBuyButton />
				</ProductProvider>
			</ShopkitProvider>,
		);

		await act(async () => {
			screen.getByTestId("buy").click();
		});
		await waitFor(() => expect(assign).toHaveBeenCalled());

		expect(fake.calls.find((c) => c.url.endsWith("/items"))?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 1,
			properties: [{ propertyId: 12, value: "Anna" }],
		});
	});
});

describe("useProductAddToCart().addToCart with properties", () => {
	it("adds the selected variant with the shopper's product-field input", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{ match: "POST /v2/cart/cart-1/items", status: 201, body: FULL_CART },
		]);
		function AddButton() {
			const { addToCart } = useProductAddToCart();
			return (
				<button
					type="button"
					data-testid="add"
					onClick={() =>
						void addToCart(2, [
							{ propertyId: 12, value: "Anna" },
							{ propertyId: 13, value: "1" },
						])
					}
				>
					Lägg i varukorgen
				</button>
			);
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<ProductProvider product={SIZED} initialVariantId={10}>
					<AddButton />
				</ProductProvider>
			</ShopkitProvider>,
		);

		await act(async () => {
			screen.getByTestId("add").click();
		});
		await waitFor(() =>
			expect(fake.calls.some((c) => c.url.endsWith("/items"))).toBe(true),
		);

		expect(fake.calls.find((c) => c.url.endsWith("/items"))?.body).toEqual({
			productId: "prod_27",
			variantId: 10,
			quantity: 2,
			properties: [
				{ propertyId: 12, value: "Anna" },
				{ propertyId: 13, value: "1" },
			],
		});
	});
});

describe("useCart().clearCart", () => {
	it("is the same function as clear", async () => {
		const fake = createFakeFetch([]);
		let result: ReturnType<typeof useCart> | null = null;
		function Probe() {
			result = useCart();
			return null;
		}
		render(
			<ShopkitProvider client={makeClient(fake.fetch)}>
				<Probe />
			</ShopkitProvider>,
		);
		expect(result).not.toBeNull();
		const cart = result as unknown as ReturnType<typeof useCart>;
		expect(cart.clearCart).toBe(cart.clear);
		await act(async () => {
			await cart.clearCart();
		});
		// Nothing remembered, nothing to delete.
		expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
	});
});

describe("<ShopkitProvider storefrontId>", () => {
	function captureContext() {
		const seen: ShopkitContextValue[] = [];
		function Probe() {
			seen.push(useShopkitContext());
			return null;
		}
		return { seen, Probe };
	}

	it("binds the client it builds to the campaign", () => {
		const { seen, Probe } = captureContext();
		render(
			<ShopkitProvider
				config={{ publishableKey: TEST_KEY, storage: "memory" }}
				storefrontId={SF_ID}
			>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client.storefront).toEqual({
			id: SF_ID,
			surface: "shopkit",
		});
	});

	it("rebuilds the client and the cart store when the campaign changes", () => {
		const { seen, Probe } = captureContext();
		const config = { publishableKey: TEST_KEY, storage: "memory" as const };
		const { rerender } = render(
			<ShopkitProvider config={config} storefrontId={SF_ID}>
				<Probe />
			</ShopkitProvider>,
		);
		const first = seen.at(-1);
		rerender(
			<ShopkitProvider config={config} storefrontId={SF_ID}>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client).toBe(first?.client);

		rerender(
			<ShopkitProvider config={config} storefrontId={OTHER_SF_ID}>
				<Probe />
			</ShopkitProvider>,
		);
		const second = seen.at(-1);
		expect(second?.client.storefront?.id).toBe(OTHER_SF_ID);
		expect(second?.client).not.toBe(first?.client);
		expect(second?.cartStore).not.toBe(first?.cartStore);
	});

	it("keeps the client for the same campaign spelled differently or moved from the config", () => {
		const { seen, Probe } = captureContext();
		const { rerender } = render(
			<ShopkitProvider
				config={{ publishableKey: TEST_KEY, storage: "memory" }}
				storefrontId={SF_ID}
			>
				<Probe />
			</ShopkitProvider>,
		);
		const first = seen.at(-1);

		// Ids are case-insensitive: the same campaign, the same client and cart.
		rerender(
			<ShopkitProvider
				config={{ publishableKey: TEST_KEY, storage: "memory" }}
				storefrontId={SF_ID.toLowerCase()}
			>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client).toBe(first?.client);

		// The same id, now on the config instead of the prop.
		rerender(
			<ShopkitProvider
				config={{
					publishableKey: TEST_KEY,
					storage: "memory",
					storefrontId: SF_ID,
				}}
			>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client).toBe(first?.client);
		expect(seen.at(-1)?.cartStore).toBe(first?.cartStore);
	});

	it("refuses a config whose own storefrontId disagrees", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() =>
			render(
				<ShopkitProvider
					config={{ publishableKey: TEST_KEY, storefrontId: OTHER_SF_ID }}
					storefrontId={SF_ID}
				>
					<span />
				</ShopkitProvider>,
			),
		).toThrow(ShopkitConfigError);
	});

	it("accepts a prebuilt client bound to the same campaign", () => {
		const { seen, Probe } = captureContext();
		const client = makeClient(createFakeFetch([]).fetch, SF_ID);
		render(
			<ShopkitProvider client={client} storefrontId={SF_ID.toLowerCase()}>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client).toBe(client);
	});

	it.each([
		["unbound", undefined],
		["bound elsewhere", OTHER_SF_ID],
	])("throws for a prebuilt client that is %s", (_label, bound) => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = makeClient(createFakeFetch([]).fetch, bound);
		expect(() =>
			render(
				<ShopkitProvider client={client} storefrontId={SF_ID}>
					<span />
				</ShopkitProvider>,
			),
		).toThrow(/cannot rebind it/);
	});

	it("treats null as not set", () => {
		const { seen, Probe } = captureContext();
		render(
			<ShopkitProvider
				config={{ publishableKey: TEST_KEY, storage: "memory" }}
				storefrontId={null}
			>
				<Probe />
			</ShopkitProvider>,
		);
		expect(seen.at(-1)?.client.storefront).toBeNull();
	});
});
