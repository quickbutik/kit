import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShopkit } from "../src/react/context.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { useCart } from "../src/react/use-cart.js";
import { useProductSearch, useProducts } from "../src/react/use-catalog.js";
import {
	useCheckout,
	useOrderConfirmation,
} from "../src/react/use-checkout.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient, type ShopkitClient } from "../src/sdk/client.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

function makeClient(
	fetchImpl: typeof globalThis.fetch,
	storage = createMemoryStorage(),
) {
	return createShopkitClient({
		// Consent and analytics are on by default under <ShopkitProvider>; this
		// suite tests the shop surfaces as they are without them (they have their
		// own suites), so its clients opt out.
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		checkoutUrl: "https://checkout.test",
		fetch: fetchImpl,
		storage,
		maxRetries: 0,
	});
}

function wrap(client: ShopkitClient, ui: React.ReactNode) {
	return render(<ShopkitProvider client={client}>{ui}</ShopkitProvider>);
}

describe("ShopkitProvider", () => {
	it("exposes the client to the tree", () => {
		const client = makeClient(createFakeFetch([]).fetch);
		function ShopPrefix() {
			return <span>{useShopkit().shopPrefix}</span>;
		}
		wrap(client, <ShopPrefix />);
		expect(screen.getByText("shop123")).toBeTruthy();
	});

	it("fails with a named error when a hook is used outside a provider", () => {
		function Orphan() {
			useShopkit();
			return null;
		}
		// React logs the thrown error; silence it so the run stays readable.
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => render(<Orphan />)).toThrow(/ShopkitProvider/);
		spy.mockRestore();
	});
});

describe("useCart", () => {
	function CartView() {
		const { cart, itemCount, status, pending, add, updateItem, clear } =
			useCart();
		return (
			<div>
				<span data-testid="status">{status}</span>
				<span data-testid="count">{itemCount}</span>
				<span data-testid="pending">{pending}</span>
				<span data-testid="id">{cart?.id ?? "none"}</span>
				<button type="button" onClick={() => void add({ productId: "prod_1" })}>
					add
				</button>
				<button type="button" onClick={() => void updateItem("item-1", 0)}>
					zero
				</button>
				<button type="button" onClick={() => void clear()}>
					clear
				</button>
			</div>
		);
	}

	it("loads nothing and creates nothing for a first-time visitor", async () => {
		const fake = createFakeFetch([]);
		wrap(makeClient(fake.fetch), <CartView />);

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("ready"),
		);
		expect(screen.getByTestId("count").textContent).toBe("0");
		expect(fake.calls).toHaveLength(0);
	});

	it("hydrates the remembered cart on mount", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ itemCount: 3 }) },
		]);

		wrap(makeClient(fake.fetch, storage), <CartView />);

		await waitFor(() =>
			expect(screen.getByTestId("count").textContent).toBe("3"),
		);
		expect(screen.getByTestId("id").textContent).toBe("cart-1");
	});

	it("adds an item and folds the server's cart back into state", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 1 }),
			},
		]);
		wrap(makeClient(fake.fetch), <CartView />);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("ready"),
		);

		await act(async () => {
			screen.getByText("add").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("count").textContent).toBe("1"),
		);
		expect(screen.getByTestId("pending").textContent).toBe("0");
	});

	it("captures a failed mutation as state instead of throwing", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 400,
				body: { message: "out of stock" },
			},
		]);
		wrap(makeClient(fake.fetch), <CartView />);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("ready"),
		);

		await act(async () => {
			screen.getByText("add").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("error"),
		);
	});

	it("treats quantity 0 as a removal", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope({ itemCount: 1 }) },
			{
				match: "DELETE /v2/cart/cart-1/items/item-1",
				body: cartEnvelope({ itemCount: 0 }),
			},
		]);
		wrap(makeClient(fake.fetch, storage), <CartView />);
		await waitFor(() =>
			expect(screen.getByTestId("count").textContent).toBe("1"),
		);

		await act(async () => {
			screen.getByText("zero").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("count").textContent).toBe("0"),
		);
		expect(fake.calls.some((c) => c.method === "DELETE")).toBe(true);
	});

	it("shares one cart across two components", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/cart/cart-1/items",
				status: 201,
				body: cartEnvelope({ itemCount: 2 }),
			},
		]);
		function Badge() {
			return <span data-testid="badge">{useCart().itemCount}</span>;
		}
		wrap(
			makeClient(fake.fetch),
			<>
				<CartView />
				<Badge />
			</>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("ready"),
		);

		await act(async () => {
			screen.getByText("add").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("badge").textContent).toBe("2"),
		);
		expect(screen.getByTestId("count").textContent).toBe("2");
		// One create for the pair, not one each.
		expect(
			fake.calls.filter(
				(c) => c.method === "POST" && c.url.endsWith("/v2/cart"),
			),
		).toHaveLength(1);
	});

	it("starts from a server-fetched cart when given one", async () => {
		const fake = createFakeFetch([]);
		render(
			<ShopkitProvider
				client={makeClient(fake.fetch)}
				initialCart={{ ...cartEnvelope({ itemCount: 5 }).data } as never}
			>
				<CartView />
			</ShopkitProvider>,
		);
		// No loading flash: the count is right on the first paint.
		expect(screen.getByTestId("count").textContent).toBe("5");
		expect(fake.calls).toHaveLength(0);
	});
});

describe("useProducts", () => {
	it("fetches a page and exposes loading state", async () => {
		const fake = createFakeFetch([
			{
				match: "GET /v2/products",
				body: {
					data: [{ id: "prod_1", name: "Sneakers" }],
					has_more: false,
					next_cursor: null,
				},
			},
		]);
		function Grid() {
			const { data, loading } = useProducts({ limit: 12 });
			if (loading) return <span>loading</span>;
			return <span>{data?.data[0]?.name}</span>;
		}
		wrap(makeClient(fake.fetch), <Grid />);

		expect(screen.getByText("loading")).toBeTruthy();
		await waitFor(() => expect(screen.getByText("Sneakers")).toBeTruthy());
		expect(fake.calls[0]?.url).toContain("limit=12");
	});

	it("surfaces an error instead of hanging on loading", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products", status: 403, body: { title: "Forbidden" } },
		]);
		function Grid() {
			const { error, loading } = useProducts();
			if (loading) return <span>loading</span>;
			return <span>{error ? `err:${error.message}` : "no error"}</span>;
		}
		wrap(makeClient(fake.fetch), <Grid />);

		await waitFor(() => expect(screen.getByText(/^err:/)).toBeTruthy());
	});
});

describe("useProductSearch", () => {
	const body = {
		data: [{ id: "prod_1", name: "Merino Crew" }],
		has_more: false,
		next_cursor: null,
	};

	it("passes the filters through to the query string", async () => {
		const fake = createFakeFetch([{ match: "GET /v2/products/search", body }]);
		function Grid() {
			const { data, loading } = useProductSearch({
				search: "merino",
				sortBy: "price",
				minPrice: 20000,
				limit: 24,
			});
			if (loading) return <span>loading</span>;
			return <span>{data?.data[0]?.name}</span>;
		}
		wrap(makeClient(fake.fetch), <Grid />);

		await waitFor(() => expect(screen.getByText("Merino Crew")).toBeTruthy());
		const url = fake.calls[0]?.url ?? "";
		expect(url).toContain("/v2/products/search");
		expect(url).toContain("search=merino");
		expect(url).toContain("sortBy=price");
		expect(url).toContain("minPrice=20000");
	});

	it("does not re-fetch when the caller passes a fresh object literal", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/products/search", body },
			{ match: "GET /v2/products/search", body },
		]);
		function Grid({ tick }: { tick: number }) {
			// A NEW object every render — the failure mode this guards is a
			// dependency list keyed on identity, which would refetch forever.
			const { data } = useProductSearch({ search: "merino", limit: 24 });
			return (
				<span>
					{tick}:{data?.data[0]?.name ?? "-"}
				</span>
			);
		}
		const client = makeClient(fake.fetch);
		const { rerender } = wrap(client, <Grid tick={1} />);

		await waitFor(() => expect(screen.getByText("1:Merino Crew")).toBeTruthy());
		// Re-wrapped: `rerender` replaces the whole root, so dropping the provider
		// here would make `useShopkit` throw rather than test anything.
		rerender(
			<ShopkitProvider client={client}>
				<Grid tick={2} />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(screen.getByText("2:Merino Crew")).toBeTruthy());

		expect(fake.calls).toHaveLength(1);
	});
});

describe("useCheckout", () => {
	it("creates the session and returns the hosted URL", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					checkout: "v2",
					hostedUrl: "https://platform-checkout.test/checkout/42/sess-1",
					sessionId: "sess-1",
					cartId: "cart-1",
					successUrl: "https://myshop.test/order",
					cancelUrl: null,
					backUrl: null,
					language: null,
					origin: null,
					fields: {},
					data: {},
				},
			},
		]);
		function Button() {
			const { start, url, starting } = useCheckout();
			return (
				<div>
					<span data-testid="url">{url ?? "none"}</span>
					<span data-testid="starting">{String(starting)}</span>
					<button
						type="button"
						onClick={() =>
							void start({ successUrl: "https://myshop.test/order" })
						}
					>
						go
					</button>
				</div>
			);
		}
		wrap(makeClient(fake.fetch), <Button />);

		await act(async () => {
			screen.getByText("go").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("url").textContent).toBe(
				"https://checkout.test/checkout/42/sess-1",
			),
		);
		expect(screen.getByTestId("starting").textContent).toBe("false");
	});

	it("exposes a failed session creation as an error", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/cart", status: 201, body: cartEnvelope() },
			{
				match: "POST /v2/checkout/handoff",
				status: 400,
				body: { message: "successUrl must use https" },
			},
		]);
		function Button() {
			const { start, error } = useCheckout();
			return (
				<div>
					<span data-testid="error">{error?.message ?? "none"}</span>
					<button
						type="button"
						onClick={() => void start({ successUrl: "http://shop.test/x" })}
					>
						go
					</button>
				</div>
			);
		}
		wrap(makeClient(fake.fetch), <Button />);

		await act(async () => {
			screen.getByText("go").click();
		});

		await waitFor(() =>
			expect(screen.getByTestId("error").textContent).toMatch(/must use https/),
		);
	});
});

describe("useOrderConfirmation", () => {
	it("polls the remembered session and reports the order number", async () => {
		const storage = createMemoryStorage();
		await storage.set("qb_checkout_session", "sess-1");
		const fake = createFakeFetch([
			{
				match: "GET /v2/checkout/sessions/sess-1/confirmation",
				body: { status: "completed", orderNumber: 777 },
			},
		]);
		function ThankYou() {
			const { status, orderNumber, loading } = useOrderConfirmation();
			if (loading) return <span>polling</span>;
			return <span>{`${status}:${orderNumber}`}</span>;
		}
		wrap(makeClient(fake.fetch, storage), <ThankYou />);

		await waitFor(() => expect(screen.getByText("completed:777")).toBeTruthy());
	});

	it("errors clearly when there is no session to confirm", async () => {
		const fake = createFakeFetch([]);
		function ThankYou() {
			const { error, loading } = useOrderConfirmation();
			if (loading) return <span>polling</span>;
			return <span>{error?.message ?? "none"}</span>;
		}
		wrap(makeClient(fake.fetch), <ThankYou />);

		await waitFor(() =>
			expect(screen.getByText(/no checkout session/)).toBeTruthy(),
		);
	});
});
