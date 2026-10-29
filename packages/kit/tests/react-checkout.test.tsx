import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Checkout } from "../src/react/checkout.js";
import { useShopkitContext } from "../src/react/context.js";
import { ShopkitProvider } from "../src/react/provider.js";
import { createMemoryStorage } from "../src/runtime/storage.js";
import { createShopkitClient } from "../src/sdk/client.js";
import type { CartStore } from "../src/state/cart-store.js";
import { frameIn, sendFromFrame, stubFrameWindow } from "./embed-helpers.js";
import { embedFrameMessageFixtures } from "./fixtures/embed-messages.fixtures.js";
import {
	cartEnvelope,
	cartLine,
	createFakeFetch,
	type FakeRoute,
	TEST_KEY,
} from "./helpers.js";

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
	embedUrl: "https://checkout.test/embed/42/sess-1",
};

/** `start()` patches a session whose cart snapshot is stale, and this one is. */
const PATCH_ROUTE: FakeRoute = {
	match: "PATCH /v2/checkout/sessions/sess-1",
	body: { fields: {}, data: {} },
};

/** A cart with one line in it: something to check out. */
const FULL_CART = cartEnvelope({
	items: [cartLine()],
	itemCount: 1,
	total: 9900,
	storeId: 42,
});

/**
 * A client with a cart remembered. The cart is read by the cart store the
 * component follows AND by `start()` on the way to the handoff, so several
 * GETs are answered. One handoff: a test that expects a second one says so
 * in `extra`, and a StrictMode double mount that made two would fail on the
 * missing route rather than pass by accident.
 */
async function makeClient(
	cart: ReturnType<typeof cartEnvelope> = FULL_CART,
	extra: FakeRoute[] = [],
	/**
	 * Sits in front of the double, for a test that needs to hold one request
	 * open — the only way to put a cart change INSIDE the window a `mount()` is
	 * in flight.
	 */
	wrapFetch: (inner: typeof globalThis.fetch) => typeof globalThis.fetch = (
		inner,
	) => inner,
) {
	const fake = createFakeFetch([
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "GET /v2/cart/cart-1", body: cart },
		{ match: "POST /v2/checkout/handoff", status: 201, body: HANDOFF },
		PATCH_ROUTE,
		...extra,
	]);
	const storage = createMemoryStorage();
	await storage.set("qb_cart_id", "cart-1");
	return {
		fake,
		storage,
		client: createShopkitClient({
			// Consent and analytics are on by default under <ShopkitProvider>; this
			// suite tests the shop surfaces as they are without them (they have their
			// own suites), so its clients opt out.
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: wrapFetch(fake.fetch),
			storage,
			maxRetries: 0,
		}),
	};
}

function handoffs(fake: { calls: Array<{ url: string; body: unknown }> }) {
	return fake.calls.filter((call) => call.url.includes("/checkout/handoff"));
}

/** Hands the test the provider's cart store, to drive the cart as a page would. */
function CartProbe({ onStore }: { onStore: (store: CartStore) => void }) {
	onStore(useShopkitContext().cartStore);
	return null;
}

describe("<Checkout>", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/checkout");
	});

	it("mounts the embedded checkout from its props", async () => {
		const { client, fake } = await makeClient();
		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout
					successUrl="/thanks"
					backUrl="/cart"
					lang="sv"
					theme="dark"
					minHeight={480}
				/>
			</ShopkitProvider>,
		);

		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		expect(frameIn(container).getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-1?lang=sv",
		);
		expect(frameIn(container).style.height).toBe("480px");
		const call = fake.calls.find((entry) => entry.url.includes("/handoff"));
		expect(call?.body).toMatchObject({
			successUrl: `${window.location.origin}/thanks`,
			backUrl: `${window.location.origin}/cart`,
			language: "sv",
			theme: "dark",
		});
	});

	it("names no theme when the page does not, so the merchant's choice applies", async () => {
		// Absent is not `light`: the platform reads "no preference" and paints
		// the checkout in the shop's own theme, which a `light` here would pin
		// shut. So the key must be missing from the body, not present and empty.
		const { client, fake } = await makeClient();
		render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" />
			</ShopkitProvider>,
		);

		await waitFor(() => expect(handoffs(fake)).toHaveLength(1));
		expect(handoffs(fake)[0]?.body).not.toHaveProperty("theme");
	});

	it("reports the frame's events through its props", async () => {
		const { client } = await makeClient();
		const onReady = vi.fn();
		const onStep = vi.fn();
		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout
					successUrl="/thanks"
					confirmation="inline"
					onReady={onReady}
					onStep={onStep}
				/>
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		const { frameWindow } = stubFrameWindow(frameIn(container));

		sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
		sendFromFrame(embedFrameMessageFixtures.step, { source: frameWindow });

		expect(onReady).toHaveBeenCalledWith({
			sessionId: embedFrameMessageFixtures.ready.sessionId,
			shopId: "101928",
			step: "contact",
		});
		expect(onStep).toHaveBeenCalledWith({ step: "payment" });
	});

	it("mounts exactly once under a StrictMode double mount", async () => {
		// Effect, cleanup, effect again — on the same instance. The second run
		// joins the first run's `mount()` rather than starting its own: the
		// platform would hand the same session back anyway (the handoff is
		// idempotent per cart), so this is not about a second order; it is one
		// handoff request, one frame in the element and one write of the session
		// id instead of two of each racing.
		const { client, fake, storage } = await makeClient();
		const set = vi.spyOn(storage, "set");
		const { container, unmount } = render(
			<StrictMode>
				<ShopkitProvider client={client}>
					<Checkout successUrl="/thanks" />
				</ShopkitProvider>
			</StrictMode>,
		);

		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		// Let the dead first run's continuation settle too.
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(container.querySelectorAll("iframe")).toHaveLength(1);
		expect(
			fake.calls.filter((call) => call.url.includes("/checkout/handoff")),
		).toHaveLength(1);
		expect(
			set.mock.calls.filter((call) => call[0] === "qb_checkout_session"),
		).toHaveLength(1);

		unmount();
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
	});

	it("destroys a handle that resolves after a real unmount", async () => {
		// Unmounted while `mount()` was in flight, with no later run to take the
		// handle over: the promise still resolves, and the handle it produces
		// must not be left with a live `message` listener and a frame in a
		// detached element.
		const { client } = await makeClient();
		const { container, unmount } = render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" />
			</ShopkitProvider>,
		);
		const target = container.querySelector("div") as HTMLDivElement;
		unmount();
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(target.querySelector("iframe")).toBeNull();
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
	});

	it("resumes the session a redirect payment came back with", async () => {
		// The redirect break-out lands here: the payment provider returns the
		// shopper to the checkout's origin, which bounces to this page with the
		// session id on it. Creating a NEW session here would hand a second
		// checkout to a shopper who has already paid.
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		const { client } = await makeClient();
		await client.storage.set("qb_store_id", "42");
		const resume = vi.spyOn(client.checkout, "resume");
		const mount = vi.spyOn(client.checkout, "mount");

		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" lang="sv" />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());

		expect(mount).not.toHaveBeenCalled();
		expect(resume).toHaveBeenCalledTimes(1);
		expect(resume.mock.calls[0]?.[1]).toBe("sess-9");
		expect(frameIn(container).getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9?lang=sv",
		);
		// Not yet: the frame has not answered, and a reload now must resume.
		expect(window.location.search).toBe("?qb_checkout_session=sess-9");

		const replaceState = vi.spyOn(window.history, "replaceState");
		const { frameWindow } = stubFrameWindow(frameIn(container));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		// Stripped, so a reload cannot resume a session that is already spent.
		expect(window.location.search).toBe("");
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		expect(replaceState).toHaveBeenCalledTimes(1);
		replaceState.mockRestore();
	});

	it("keeps the return parameter when the resumed frame never answers", async () => {
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		const { client } = await makeClient();
		await client.storage.set("qb_store_id", "42");
		const realResume = client.checkout.resume.bind(client.checkout);
		vi.spyOn(client.checkout, "resume").mockImplementation(
			(target, sessionId, input) =>
				realResume(target, sessionId, { ...input, handshakeTimeoutMs: 10 }),
		);
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const onFallback = vi.fn();

		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" onFallback={onFallback} />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		await waitFor(() => expect(onFallback).toHaveBeenCalled());

		expect(onFallback.mock.calls[0]?.[0]).toMatchObject({
			reason: "handshake-timeout",
			url: "https://checkout.test/checkout/42/sess-9",
		});
		expect(window.location.search).toBe("?qb_checkout_session=sess-9");
		vi.restoreAllMocks();
	});

	it("resumes exactly once under a StrictMode double mount", async () => {
		// The parameter can only be read once — the first effect run strips it.
		// A component that re-read the URL on the second run would find nothing
		// and fall through to creating a fresh session.
		window.history.replaceState({}, "", "/checkout?qb_checkout_session=sess-9");
		const { client } = await makeClient();
		await client.storage.set("qb_store_id", "42");
		const resume = vi.spyOn(client.checkout, "resume");
		const mount = vi.spyOn(client.checkout, "mount");

		const { container } = render(
			<StrictMode>
				<ShopkitProvider client={client}>
					<Checkout successUrl="/thanks" />
				</ShopkitProvider>
			</StrictMode>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());

		expect(mount).not.toHaveBeenCalled();
		for (const call of resume.mock.calls) expect(call[1]).toBe("sess-9");
		expect(container.querySelectorAll("iframe")).toHaveLength(1);
	});

	it("reports a frame that never answers through onFallback, not onError", async () => {
		const { client } = await makeClient();
		const realMount = client.checkout.mount.bind(client.checkout);
		vi.spyOn(client.checkout, "mount").mockImplementation(
			(target, input, options) =>
				realMount(target, { ...input, handshakeTimeoutMs: 10 }, options),
		);
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const onFallback = vi.fn();
		const onError = vi.fn();

		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout
					successUrl="/thanks"
					onFallback={onFallback}
					onError={onError}
				/>
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		await waitFor(() => expect(onFallback).toHaveBeenCalled());

		expect(onFallback).toHaveBeenCalledWith({
			reason: "handshake-timeout",
			url: "https://checkout.test/checkout/42/sess-1",
		});
		expect(onError).not.toHaveBeenCalled();
		expect(container.querySelector("iframe")).toBeNull();
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
		vi.restoreAllMocks();
	});

	it("reports a checkout that could not start instead of throwing", async () => {
		// A cart with something in it, and a handoff that fails: the one kind of
		// failure that is an error here (an empty cart is not).
		const fake = createFakeFetch([
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{ match: "GET /v2/cart/cart-1", body: FULL_CART },
			{
				match: "POST /v2/checkout/handoff",
				status: 500,
				body: { message: "boom" },
			},
		]);
		const storage = createMemoryStorage();
		await storage.set("qb_cart_id", "cart-1");
		const client = createShopkitClient({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fake.fetch,
			storage,
			maxRetries: 0,
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		const onError = vi.fn();

		expect(() =>
			render(
				<ShopkitProvider client={client}>
					<Checkout successUrl="/thanks" onError={onError} />
				</ShopkitProvider>,
			),
		).not.toThrow();

		await waitFor(() => expect(onError).toHaveBeenCalled());
		expect(onError.mock.calls[0]?.[0]).toMatchObject({
			code: "unknown",
			fatal: true,
		});
		vi.restoreAllMocks();
	});

	it("stays idle on an empty cart, says so once, and never calls that an error", async () => {
		const { client, fake } = await makeClient(cartEnvelope({ storeId: 42 }));
		const onError = vi.fn();
		const onEmpty = vi.fn();
		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" onError={onError} onEmpty={onEmpty} />
			</ShopkitProvider>,
		);

		await waitFor(() => expect(onEmpty).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(handoffs(fake)).toHaveLength(0);
		expect(container.querySelector("iframe")).toBeNull();
		expect(onError).not.toHaveBeenCalled();
		expect(onEmpty).toHaveBeenCalledTimes(1);
	});

	it("mounts once the cart has something in it", async () => {
		// Empty on load, filled by the page: exactly one handoff, one frame.
		const { client, fake } = await makeClient(cartEnvelope({ storeId: 42 }), [
			{ match: "POST /v2/cart/cart-1/items", body: FULL_CART },
		]);
		let store: CartStore | null = null;
		const onEmpty = vi.fn();
		const { container } = render(
			<ShopkitProvider client={client}>
				<CartProbe onStore={(s) => (store = s)} />
				<Checkout successUrl="/thanks" onEmpty={onEmpty} />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(onEmpty).toHaveBeenCalledTimes(1));
		expect(handoffs(fake)).toHaveLength(0);

		await act(async () => {
			await store?.add({ productId: 27, variantId: 10 });
		});

		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(handoffs(fake)).toHaveLength(1);
		expect(container.querySelectorAll("iframe")).toHaveLength(1);
		expect(onEmpty).toHaveBeenCalledTimes(1);
	});

	it("takes the frame down when the page empties the cart, and starts over when it fills", async () => {
		const refilled = cartEnvelope({
			id: "cart-2",
			items: [cartLine()],
			itemCount: 1,
			total: 9900,
			storeId: 42,
		});
		const { client, fake } = await makeClient(FULL_CART, [
			{ match: "DELETE /v2/cart/cart-1", status: 204, body: null },
			{ match: "POST /v2/cart", status: 201, body: refilled },
			{ match: "POST /v2/cart/cart-2/items", body: refilled },
			{ match: "GET /v2/cart/cart-2", body: refilled },
			{
				match: "POST /v2/checkout/handoff",
				status: 201,
				body: {
					...HANDOFF,
					sessionId: "sess-2",
					cartId: "cart-2",
					embedUrl: "https://checkout.test/embed/42/sess-2",
				},
			},
			{
				match: "PATCH /v2/checkout/sessions/sess-2",
				body: { fields: {}, data: {} },
			},
		]);
		let store: CartStore | null = null;
		const onEmpty = vi.fn();
		const { container } = render(
			<ShopkitProvider client={client}>
				<CartProbe onStore={(s) => (store = s)} />
				<Checkout successUrl="/thanks" onEmpty={onEmpty} />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		const first = frameIn(container);
		expect(first.getAttribute("src")).toContain("/embed/42/sess-1");

		await act(async () => {
			await store?.clear();
		});

		// Gone: the session it showed names a cart that no longer exists.
		await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
		expect(first.isConnected).toBe(false);
		expect(onEmpty).toHaveBeenCalledTimes(1);

		await act(async () => {
			await store?.add({ productId: 27, variantId: 10 });
		});

		// A fresh session and a fresh frame, not the old one put back.
		await waitFor(() => expect(frameIn(container)).toBeTruthy());
		expect(frameIn(container).getAttribute("src")).toContain(
			"/embed/42/sess-2",
		);
		// Two handoffs in total: the first for cart-1, the second for cart-2. The
		// routes above answer exactly the second one with sess-2.
		expect(handoffs(fake)).toHaveLength(2);
		expect(handoffs(fake)[1]?.body).toMatchObject({ cartId: "cart-2" });
		expect(container.querySelectorAll("iframe")).toHaveLength(1);
	});

	describe("when the page changes the cart under a live frame", () => {
		const REPRICED = cartEnvelope({
			items: [{ ...cartLine(), quantity: 2 }],
			itemCount: 2,
			total: 19800,
			storeId: 42,
		});

		const CART_UPDATED = {
			source: "qb-checkout-embed",
			v: 1,
			type: "cart-updated",
		};

		/** A mounted `<Checkout>` with its frame stubbed, ready to be driven. */
		async function framed(extra: FakeRoute[]) {
			const { client } = await makeClient(FULL_CART, extra);
			let store: CartStore | null = null;
			const { container } = render(
				<ShopkitProvider client={client}>
					<CartProbe onStore={(s) => (store = s)} />
					<Checkout successUrl="/thanks" />
				</ShopkitProvider>,
			);
			await waitFor(() => expect(frameIn(container)).toBeTruthy());
			const { frameWindow, posted } = stubFrameWindow(frameIn(container));
			return {
				container,
				frameWindow,
				store: () => store,
				// Everything said after the handshake's own `init`.
				said: () =>
					posted().filter(
						(message) => (message as { type: string }).type !== "init",
					),
				posted,
			};
		}

		it("tells the frame exactly once per change", async () => {
			const { frameWindow, store, said } = await framed([
				{ match: "PATCH /v2/cart/cart-1/items/line-1", body: REPRICED },
			]);
			act(() => {
				sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			});

			await act(async () => {
				await store()?.updateItem("line-1", 2);
			});

			// The store notifies three times over one mutation (pending up, the
			// new cart, pending down). The frame hears about it once.
			expect(said()).toEqual([CART_UPDATED]);
		});

		it("holds a change made before the frame answered, and sends it on ready", async () => {
			const { frameWindow, store, posted, said } = await framed([
				{ match: "PATCH /v2/cart/cart-1/items/line-1", body: REPRICED },
			]);

			// Nothing is posted into a frame that is not listening yet...
			await act(async () => {
				await store()?.updateItem("line-1", 2);
			});
			expect(posted()).toHaveLength(0);

			// ...and nothing is lost either. The frame renders the cart the
			// session snapshotted and never re-reads it on its own, so a change
			// dropped here is a shopper charged for the cart they just changed.
			act(() => {
				sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			});
			expect(said()).toEqual([CART_UPDATED]);
		});

		it("holds a change made while the session was still being created", async () => {
			// The half no effect can see: the handle is still null, so the
			// revision effect returns without advancing `sentRevision`. The
			// session's cart was snapshotted before the change, and the frame
			// does not re-read it — so `ready` is the moment to say so.
			let releaseHandoff: () => void = () => {};
			const handoff = new Promise<void>((resolve) => {
				releaseHandoff = resolve;
			});
			const { client } = await makeClient(
				FULL_CART,
				[{ match: "PATCH /v2/cart/cart-1/items/line-1", body: REPRICED }],
				(inner) =>
					(async (input: RequestInfo | URL, init?: RequestInit) => {
						const request =
							input instanceof Request ? input : new Request(input, init);
						if (new URL(request.url).pathname.endsWith("/checkout/handoff")) {
							await handoff;
						}
						return inner(input, init);
					}) as typeof globalThis.fetch,
			);
			let store: CartStore | null = null;
			const currentStore = () => store;
			const { container } = render(
				<ShopkitProvider client={client}>
					<CartProbe onStore={(s) => (store = s)} />
					<Checkout successUrl="/thanks" />
				</ShopkitProvider>,
			);
			await waitFor(() => expect(currentStore()).toBeTruthy());
			// The handoff is still open, so there is no handle to tell.
			expect(container.querySelector("iframe")).toBeNull();

			await act(async () => {
				await currentStore()?.updateItem("line-1", 2);
				releaseHandoff();
			});
			await waitFor(() => expect(frameIn(container)).toBeTruthy());
			const { frameWindow, posted } = stubFrameWindow(frameIn(container));
			act(() => {
				sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			});

			expect(
				posted().filter(
					(message) => (message as { type: string }).type !== "init",
				),
			).toEqual([CART_UPDATED]);
		});

		it("tears the frame down, rather than telling it, when the cart empties", async () => {
			const { container, frameWindow, store, said } = await framed([
				{ match: "DELETE /v2/cart/cart-1", status: 204, body: null },
			]);
			act(() => {
				sendFromFrame(embedFrameMessageFixtures.ready, { source: frameWindow });
			});

			await act(async () => {
				await store()?.clear();
			});

			// `clear()` is a mutation too, but a cart that is gone is not a cart
			// to re-read: the effect that owns the frame has already taken it
			// down by the time the one that reports cart changes runs.
			await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
			expect(said()).toEqual([]);
		});
	});

	it("resumes from the URL alone, with an empty store and no cart", async () => {
		// The order exists, so the platform has dropped the cart and the kit has
		// forgotten it, store id included. Both halves come off the URL.
		window.history.replaceState(
			{},
			"",
			"/checkout?qb_checkout_session=sess-9&qb_checkout_shop=42&x=1",
		);
		const fake = createFakeFetch([]);
		const client = createShopkitClient({
			consent: false,
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			checkoutUrl: "https://checkout.test",
			fetch: fake.fetch,
			storage: createMemoryStorage(),
			maxRetries: 0,
		});
		const resume = vi.spyOn(client.checkout, "resume");
		const onError = vi.fn();
		const onEmpty = vi.fn();

		const { container } = render(
			<ShopkitProvider client={client}>
				<Checkout successUrl="/thanks" onError={onError} onEmpty={onEmpty} />
			</ShopkitProvider>,
		);
		await waitFor(() => expect(frameIn(container)).toBeTruthy());

		expect(fake.calls).toHaveLength(0);
		expect(resume.mock.calls[0]?.[1]).toBe("sess-9");
		expect(resume.mock.calls[0]?.[2]).toMatchObject({ storeId: "42" });
		expect(frameIn(container).getAttribute("src")).toBe(
			"https://checkout.test/embed/42/sess-9",
		);
		expect(onError).not.toHaveBeenCalled();
		// An empty cart store under a return leg is expected, not "empty".
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(onEmpty).not.toHaveBeenCalled();
		expect(container.querySelectorAll("iframe")).toHaveLength(1);

		const { frameWindow } = stubFrameWindow(frameIn(container));
		sendFromFrame(
			{ ...embedFrameMessageFixtures.ready, sessionId: "sess-9" },
			{ source: frameWindow },
		);
		// Both parameters come off, once; the page's own stays.
		expect(window.location.search).toBe("?x=1");
		resume.mockRestore();
	});
});
