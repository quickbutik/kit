import { vi } from "vitest";
import type { CartItem } from "../src/sdk/types/cart.js";

export const TEST_KEY = "qb_pk_shop123_abcdef0123456789abcdef0123456789";

export interface FakeRoute {
	/** `"POST /v2/cart"` — matched against method + pathname, query ignored. */
	match: string;
	status?: number;
	body?: unknown;
	/** Raw text body, for testing non-JSON responses. */
	text?: string;
}

export interface FakeFetch {
	fetch: typeof globalThis.fetch;
	/** Every request made, in order. */
	calls: Array<{
		method: string;
		url: string;
		body: unknown;
		headers: Headers;
	}>;
}

/**
 * A fetch double that answers from a queue of routes.
 *
 * Routes are consumed in order when several share the same `match`, so a test
 * can script "first call 500, second call 200" without reaching for mock
 * implementations.
 *
 * Normalizes both call shapes: shopkit's transport runs on the platform's
 * hey-api client, which builds a `Request` and calls `fetch(request)` with no
 * second argument — but the retry/timeout wrappers around it call
 * `fetch(input, init)`. A double that only understood one of the two would
 * silently see every request as a bodyless GET.
 */
export function createFakeFetch(routes: FakeRoute[]): FakeFetch {
	const remaining = [...routes];
	const calls: FakeFetch["calls"] = [];

	const fetchImpl = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const request =
				input instanceof Request ? input : new Request(input, init);
			const url = request.url;
			const method = request.method.toUpperCase();
			const pathname = new URL(url).pathname;
			const key = `${method} ${pathname}`;

			// Honour the signal the way a real fetch does — the transport's abort
			// handling is only meaningfully exercised if the double can abort.
			const signal = init?.signal ?? request.signal;
			if (signal?.aborted) {
				const error = new Error("The operation was aborted.");
				error.name = "AbortError";
				throw error;
			}

			// Read the body before matching: a Request body is a one-shot stream, and
			// a failed match must not leave the recorded call bodyless.
			const rawBody = await request.text().catch(() => "");
			calls.push({
				method,
				url,
				body: rawBody ? safeParse(rawBody) : null,
				headers: new Headers(request.headers),
			});

			const index = remaining.findIndex((route) => route.match === key);
			if (index === -1) {
				throw new Error(`fake fetch: no route for ${key} (url: ${url})`);
			}
			const route = remaining.splice(index, 1)[0];
			if (!route) throw new Error("fake fetch: route vanished");

			const payload = route.text ?? JSON.stringify(route.body ?? null);
			return new Response(payload, {
				status: route.status ?? 200,
				headers: {
					"content-type": route.text ? "text/plain" : "application/json",
				},
			});
		},
	);

	return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** A cart payload in the platform API's envelope, as the gateway forwards it. */
export function cartEnvelope(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			id: "cart-1",
			storeId: 42,
			items: [],
			itemCount: 0,
			currency: "SEK",
			subtotal: 0,
			subtotalExclTax: 0,
			subtotalInclTax: 0,
			totalTax: 0,
			totalDiscount: 0,
			total: 0,
			totalExclTax: 0,
			totalInclTax: 0,
			createdAt: "2026-08-21T00:00:00.000Z",
			updatedAt: "2026-08-21T00:00:00.000Z",
			...overrides,
		},
		message: "ok",
		statusCode: 200,
	};
}

/** One cart line, for a cart that has something to check out. */
export function cartLine(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "line-1",
		productId: 27,
		variantId: 10,
		quantity: 1,
		productTitle: "Tee",
		variantName: null,
		sku: "tee",
		imageUrl: null,
		unitPrice: 9900,
		unitPriceExclTax: 7920,
		unitPriceInclTax: 9900,
		compareAtPrice: null,
		taxRate: 25,
		taxAmount: 1980,
		discountAmount: 0,
		lineTotal: 9900,
		lineTotalTax: 1980,
		lineTotalExclTax: 7920,
		lineTotalInclTax: 9900,
		available: true,
		...overrides,
	};
}
