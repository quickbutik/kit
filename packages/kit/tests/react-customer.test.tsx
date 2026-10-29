import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShopkitProvider } from "../src/react/provider.js";
import { useCart } from "../src/react/use-cart.js";
import { useProducts } from "../src/react/use-catalog.js";
import { useCustomer, useCustomerClub } from "../src/react/use-customer.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient, type ShopkitClient } from "../src/sdk/client.js";
import { ShopkitAuthError } from "../src/sdk/errors.js";
import { cartEnvelope, createFakeFetch, TEST_KEY } from "./helpers.js";

function base64url(value: string): string {
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(sub: string): string {
	const exp = Math.floor(Date.now() / 1000) + 900;
	return `h.${base64url(JSON.stringify({ sub, exp }))}.s`;
}

const CUSTOMER = {
	id: 123,
	email: "anna@example.test",
	firstName: "Anna",
	lastName: "Svensson",
	phone: null,
	isCompany: false,
	companyName: null,
	companyNumber: null,
	address: null,
	group: null,
};

const SESSION = {
	accessToken: jwt("123"),
	accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
	refreshToken: "qb_crt_1",
	refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
	customer: CUSTOMER,
};

const CLUB = {
	member: true,
	active: true,
	points: { balance: 640, lifetime: 2140 },
	reward: { targetPoints: 1000, remaining: 360 },
	earning: { pointsPerUnit: 1, currency: "SEK" },
};

function makeClient(fetchImpl: typeof globalThis.fetch) {
	return createShopkitClient({
		consent: false,
		publishableKey: TEST_KEY,
		apiUrl: "https://gateway.test",
		fetch: fetchImpl,
		storage: createMemoryStorage(),
		maxRetries: 0,
	});
}

function wrap(client: ShopkitClient, ui: React.ReactNode) {
	return render(<ShopkitProvider client={client}>{ui}</ShopkitProvider>);
}

function Account() {
	const { customer, isLoggedIn, loading, error, login, logout } = useCustomer();
	return (
		<div>
			<span data-testid="state">{isLoggedIn ? "in" : "out"}</span>
			<span data-testid="name">{customer?.firstName ?? "-"}</span>
			<span data-testid="loading">{String(loading)}</span>
			<span data-testid="error">
				{error instanceof ShopkitAuthError ? error.code : "-"}
			</span>
			<button
				type="button"
				onClick={() =>
					void login({ email: "a@b.test", password: "x" }).catch(
						() => undefined,
					)
				}
			>
				login
			</button>
			<button type="button" onClick={() => void logout()}>
				logout
			</button>
		</div>
	);
}

describe("useCustomer", () => {
	it("logs in and out, re-rendering every consumer", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: SESSION },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		wrap(makeClient(fake.fetch), <Account />);
		expect(screen.getByTestId("state").textContent).toBe("out");

		await act(async () => screen.getByText("login").click());
		await waitFor(() =>
			expect(screen.getByTestId("name").textContent).toBe("Anna"),
		);
		expect(screen.getByTestId("state").textContent).toBe("in");
		expect(screen.getByTestId("loading").textContent).toBe("false");

		await act(async () => screen.getByText("logout").click());
		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("out"),
		);
		expect(screen.getByTestId("name").textContent).toBe("-");
	});

	it("puts a failed login on error", async () => {
		const fake = createFakeFetch([
			{
				match: "POST /v2/account/login",
				status: 401,
				body: { statusCode: 401, message: "no", code: "invalid_credentials" },
			},
		]);
		wrap(makeClient(fake.fetch), <Account />);
		await act(async () => screen.getByText("login").click());
		await waitFor(() =>
			expect(screen.getByTestId("error").textContent).toBe(
				"invalid_credentials",
			),
		);
		expect(screen.getByTestId("state").textContent).toBe("out");
	});

	it("registers, resets a password and puts their failures on error", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/register", status: 201, body: SESSION },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
			{ match: "POST /v2/account/password/forgot", status: 202, text: "" },
			{
				match: "POST /v2/account/password/reset",
				status: 400,
				body: { statusCode: 400, message: "no", code: "invalid_reset_code" },
			},
			{ match: "POST /v2/account/password/reset", body: SESSION },
		]);
		let api: ReturnType<typeof useCustomer> | null = null;
		function Capture() {
			api = useCustomer();
			return null;
		}
		const hook = () => api as unknown as ReturnType<typeof useCustomer>;
		wrap(
			makeClient(fake.fetch),
			<>
				<Account />
				<Capture />
			</>,
		);

		let registered: Awaited<
			ReturnType<ReturnType<typeof useCustomer>["register"]>
		> | null = null;
		await act(async () => {
			registered = await hook().register({
				email: "a@b.test",
				password: "secret1",
				firstName: "Anna",
				lastName: "Svensson",
			});
		});
		expect(registered).toMatchObject({ status: "logged_in" });
		await waitFor(() =>
			expect(screen.getByTestId("name").textContent).toBe("Anna"),
		);
		expect(screen.getByTestId("state").textContent).toBe("in");

		await act(async () => screen.getByText("logout").click());
		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("out"),
		);

		await act(async () => {
			await hook().requestPasswordReset({ email: "a@b.test" });
		});
		const input = { email: "a@b.test", code: "ABCD2345", password: "new123" };
		await act(async () => {
			await hook()
				.resetPassword(input)
				.catch(() => undefined);
		});
		// Each useCustomer() keeps its own loading and error.
		await waitFor(() =>
			expect((hook().error as ShopkitAuthError | null)?.code).toBe(
				"invalid_reset_code",
			),
		);
		expect(screen.getByTestId("state").textContent).toBe("out");

		await act(async () => {
			await hook().resetPassword(input);
		});
		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("in"),
		);
		expect(hook().error).toBeNull();
		expect(hook().loading).toBe(false);
	});

	it("reads the profile for a session that has none yet", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/account", body: CUSTOMER },
		]);
		const client = makeClient(fake.fetch);
		await client.customers.setSession({ accessToken: jwt("123") });
		wrap(client, <Account />);
		expect(screen.getByTestId("state").textContent).toBe("in");
		await waitFor(() =>
			expect(screen.getByTestId("name").textContent).toBe("Anna"),
		);
	});
});

describe("useCustomerClub", () => {
	function Club() {
		const { data, loading } = useCustomerClub();
		return (
			<span data-testid="club">
				{loading ? "loading" : data ? String(data.points.balance) : "none"}
			</span>
		);
	}

	it("is null for a guest without a request", async () => {
		const fake = createFakeFetch([]);
		wrap(makeClient(fake.fetch), <Club />);
		await waitFor(() =>
			expect(screen.getByTestId("club").textContent).toBe("none"),
		);
		expect(fake.calls).toHaveLength(0);
	});

	it("loads on login and clears on logout", async () => {
		const fake = createFakeFetch([
			{ match: "POST /v2/account/login", body: SESSION },
			{ match: "GET /v2/account/club", body: CLUB },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		const client = makeClient(fake.fetch);
		wrap(client, <Club />);
		await act(async () => {
			await client.customers.login({ email: "a@b.test", password: "x" });
		});
		await waitFor(() =>
			expect(screen.getByTestId("club").textContent).toBe("640"),
		);
		await act(async () => {
			await client.customers.logout();
		});
		await waitFor(() =>
			expect(screen.getByTestId("club").textContent).toBe("none"),
		);
	});
});

describe("customer changes refetch shop data", () => {
	it("useProducts refetches with the token after login", async () => {
		const page = (name: string) => ({
			data: [{ id: "prod_1", name, price: 1, variants: [], images: [] }],
			has_more: false,
			next_cursor: null,
		});
		const fake = createFakeFetch([
			{ match: "GET /v2/products", body: page("guest") },
			{ match: "POST /v2/account/login", body: SESSION },
			{ match: "GET /v2/products", body: page("member") },
		]);
		const client = makeClient(fake.fetch);
		function List() {
			const { data } = useProducts();
			return <span data-testid="name">{data?.data[0]?.name ?? "-"}</span>;
		}
		wrap(client, <List />);
		await waitFor(() =>
			expect(screen.getByTestId("name").textContent).toBe("guest"),
		);
		await act(async () => {
			await client.customers.login({ email: "a@b.test", password: "x" });
		});
		await waitFor(() =>
			expect(screen.getByTestId("name").textContent).toBe("member"),
		);
		const last = fake.calls.at(-1);
		expect(last?.headers.get("x-customer-token")).toBe(SESSION.accessToken);
	});

	it("useCart forgets the cart on logout", async () => {
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: cartEnvelope() },
			{ match: "POST /v2/account/logout", status: 204, text: "" },
		]);
		const client = makeClient(fake.fetch);
		await client.customers.setSession({
			accessToken: jwt("123"),
			refreshToken: "r",
		});
		await client.storage.set("qb_cart_id", "cart-1");
		function CartId() {
			const { cart } = useCart();
			return <span data-testid="cart">{cart?.id ?? "none"}</span>;
		}
		wrap(client, <CartId />);
		await waitFor(() =>
			expect(screen.getByTestId("cart").textContent).toBe("cart-1"),
		);
		await act(async () => {
			await client.customers.logout();
		});
		await waitFor(() =>
			expect(screen.getByTestId("cart").textContent).toBe("none"),
		);
	});
});
