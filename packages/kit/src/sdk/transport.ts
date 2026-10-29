import type { ResolvedShopkitConfig } from "./config.js";
import {
	createApiError,
	isCustomerAuthErrorCode,
	readErrorCode,
	ShopkitApiError,
	ShopkitNetworkError,
} from "./errors.js";
import { HttpClient, type HttpResponse } from "./http.js";
import type { ApiEnvelope } from "./types/common.js";

export interface TransportRequest {
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	/** Path relative to the API version, e.g. `/checkout/sessions`. */
	path: string;
	query?: Record<string, string | number | boolean | undefined | null>;
	body?: unknown;
	signal?: AbortSignal;
	/** Message used when the server gives us nothing better. */
	errorMessage?: string;
	/**
	 * `false` never sends the customer token: the login, refresh, logout and
	 * config calls, which must not depend on (or renew) the session they
	 * manage. Every other request carries it when a customer is logged in.
	 */
	customer?: false;
}

/**
 * Where the transport gets the logged-in customer's token from, and how it
 * reports what the platform said about it. Implemented by `CustomerAuth`;
 * one per client, never shared between clients.
 */
export interface CustomerTokenSource {
	/** The token to send, renewed first when it is about to expire; null = guest. */
	token(): Promise<string | null>;
	/**
	 * The platform answered `customer_token_expired` for `token`. Renew it
	 * (one renewal however many requests ask) and return the new token, or
	 * null when the session could not be renewed and has been dropped.
	 */
	renew(token: string): Promise<string | null>;
	/** The platform will never accept `token` again: drop the session. */
	reject(token: string): Promise<void>;
}

export const CUSTOMER_TOKEN_HEADER = "X-Customer-Token";

/**
 * The one place a request to Quickbutik is made, on top of {@link HttpClient},
 * which provides auth, the `QB-Version` header, timeouts, retries, rate-limit
 * pacing and an automatic `Idempotency-Key` on every mutation (so a retried
 * `POST /cart` can never create two carts).
 *
 * This layer maps errors onto shopkit's, treats a vanished resource as `null`,
 * unwraps response envelopes, and adopts a rotated publishable key.
 */
export class Transport {
	private readonly http: HttpClient;
	private refreshInFlight: Promise<string | null> | null = null;
	private customerTokens: CustomerTokenSource | null = null;

	constructor(private readonly config: ResolvedShopkitConfig) {
		this.http = new HttpClient({
			token: config.publishableKey,
			// `apiUrl` is a bare origin; every path is relative to the version.
			baseUrl: `${config.apiUrl}/v2`,
			fetch: config.fetch,
			// `timeoutMs: 0` means no timeout, but a 0 ms timer would abort at once.
			timeoutMs: config.timeoutMs > 0 ? config.timeoutMs : MAX_TIMEOUT_MS,
			maxRetries: config.maxRetries,
			retryBaseDelayMs: RETRY_BASE_DELAY_MS,
			// `authorization` is never taken from here, so extra headers can
			// never overwrite the publishable key.
			headers: config.headers,
		});
	}

	/** Attach the logged-in customer's token to requests from now on. */
	attachCustomerTokens(source: CustomerTokenSource): void {
		this.customerTokens = source;
	}

	/** Send a request and return its body with any envelope removed. */
	async request<T>(request: TransportRequest): Promise<T> {
		const { data } = await this.send(request, false);
		return unwrapEnvelope<T>(data);
	}

	/** Send a request whose response body is discarded (204 / plain OK). */
	async requestVoid(request: TransportRequest): Promise<void> {
		await this.send(request, false);
	}

	/**
	 * Like {@link request} but resolves to null on 404/410 instead of throwing:
	 * "not there" is a normal answer for a remembered id (an expired cart).
	 */
	async requestOrNull<T>(request: TransportRequest): Promise<T | null> {
		const { data, missing } = await this.send(request, true);
		if (missing) return null;
		return unwrapEnvelope<T>(data);
	}

	private async send(
		request: TransportRequest,
		nullOnMissing: boolean,
	): Promise<SendResult> {
		const source = request.customer === false ? null : this.customerTokens;
		const token = source ? await source.token() : null;
		try {
			return this.interpret(
				request,
				await this.dispatch(request, token),
				nullOnMissing,
			);
		} catch (error) {
			const code = error instanceof ShopkitApiError ? error.code : null;
			if (source && token && code) {
				const recovered = await this.recoverCustomer(
					request,
					nullOnMissing,
					source,
					token,
					code,
				);
				if (recovered) return recovered;
			}
			// A customer-account refusal is about the shopper, not the publishable
			// key, so it must not trigger a key rotation.
			if (
				error instanceof ShopkitApiError &&
				error.status === 401 &&
				!isCustomerAuthErrorCode(code)
			) {
				const retried = await this.retryWithRefreshedKey(
					request,
					nullOnMissing,
					token,
				);
				if (retried) return retried;
			}
			throw toShopkitError(request, error);
		}
	}

	/**
	 * Handle the platform refusing the customer token. An expired token is
	 * renewed and the request retried once. A token that can never work again,
	 * or could not be renewed, drops the session, and a GET is retried as a
	 * guest. Other methods are not: a POST replayed as a guest could create an
	 * unbound cart or session. Returns null to let the original error surface.
	 */
	private async recoverCustomer(
		request: TransportRequest,
		nullOnMissing: boolean,
		source: CustomerTokenSource,
		token: string,
		code: string,
	): Promise<SendResult | null> {
		if (code === "customer_token_expired") {
			const renewed = await source.renew(token);
			if (renewed) return this.attempt(request, nullOnMissing, renewed);
		} else if (
			code === "customer_token_invalid" ||
			code === "customer_token_shop_mismatch"
		) {
			await source.reject(token);
		} else {
			return null;
		}
		if (request.method !== "GET") return null;
		// As a guest, unless a newer session (a login that landed meanwhile)
		// has a token of its own.
		const next = await source.token();
		return this.attempt(request, nullOnMissing, next === token ? null : next);
	}

	/** One more try, with its failure mapped and never recovered again. */
	private async attempt(
		request: TransportRequest,
		nullOnMissing: boolean,
		token: string | null,
	): Promise<SendResult> {
		try {
			return this.interpret(
				request,
				await this.dispatch(request, token),
				nullOnMissing,
			);
		} catch (error) {
			throw toShopkitError(request, error);
		}
	}

	/**
	 * Re-run a request once with a freshly minted key, outside the retry budget.
	 * Returns null when there is no refresh handler or it declined, so the
	 * original 401 surfaces unchanged.
	 */
	private async retryWithRefreshedKey(
		request: TransportRequest,
		nullOnMissing: boolean,
		token: string | null,
	): Promise<SendResult | null> {
		const refreshed = await this.refreshKey();
		if (!refreshed) return null;
		this.http.setToken(refreshed);
		return this.attempt(request, nullOnMissing, token);
	}

	private async dispatch(
		request: TransportRequest,
		customerToken: string | null,
	): Promise<HttpResponse> {
		try {
			return await this.http.send({
				method: request.method,
				path: request.path,
				// Per request, so a retry can send a different token, or none.
				...(customerToken && {
					headers: { [CUSTOMER_TOKEN_HEADER]: customerToken },
				}),
				query: buildQuery(request.query),
				body: request.body,
				signal: request.signal,
			});
		} catch (error) {
			// No response at all — the fetch itself failed, timed out or was aborted.
			throw new ShopkitNetworkError(
				`shopkit: ${request.method} ${request.path} could not reach the API`,
				error,
			);
		}
	}

	/** Turn a response into data, or throw. */
	private interpret(
		request: TransportRequest,
		{ response, body }: HttpResponse,
		nullOnMissing: boolean,
	): SendResult {
		if (response.ok) return { data: body, missing: false };
		if (nullOnMissing && isMissingStatus(response.status)) {
			return { data: null, missing: true };
		}
		throw buildApiError(request, response.status, body);
	}

	/** De-duped so N concurrent 401s trigger exactly one refresh. */
	private async refreshKey(): Promise<string | null> {
		if (!this.config.onUnauthorized) return null;
		if (!this.refreshInFlight) {
			this.refreshInFlight = Promise.resolve()
				.then(() => this.config.onUnauthorized?.() ?? null)
				.catch(() => null)
				.finally(() => {
					this.refreshInFlight = null;
				});
		}
		return this.refreshInFlight;
	}
}

/** `setTimeout`'s ceiling — anything larger overflows to firing immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Retry backoff base, kept short: a shopper waiting on a product grid is a
 * different latency budget from a backend batch job.
 */
const RETRY_BASE_DELAY_MS = 250;

interface SendResult {
	data: unknown;
	missing: boolean;
}

function isMissingStatus(status: number): boolean {
	return status === 404 || status === 410;
}

function fallbackMessage(request: TransportRequest): string {
	return request.errorMessage ?? `${request.method} ${request.path} failed`;
}

function toShopkitError(request: TransportRequest, error: unknown): Error {
	if (
		error instanceof ShopkitApiError ||
		error instanceof ShopkitNetworkError
	) {
		return error;
	}
	return new ShopkitNetworkError(
		`shopkit: ${request.method} ${request.path} could not reach the API`,
		error,
	);
}

/**
 * Build a ShopkitApiError from an error response: either platform envelope
 * (`{ message, statusCode }` or RFC 9457 `{ title, detail }`), a list of
 * messages, or neither when a proxy answered.
 */
function buildApiError(
	request: TransportRequest,
	status: number,
	error: unknown,
): ShopkitApiError {
	if (typeof error === "string" && error.length > 0) {
		return new ShopkitApiError(fallbackMessage(request), status, error);
	}
	if (Array.isArray(error)) {
		const message = pickMessage(error) ?? fallbackMessage(request);
		return new ShopkitApiError(message, status, error);
	}
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		const message =
			pickString(record.detail) ??
			pickMessage(record.message) ??
			pickString(record.title) ??
			pickString(record.error) ??
			fallbackMessage(request);
		return createApiError(
			message,
			status,
			error,
			extractDetails(error),
			readErrorCode(error),
			request.path,
		);
	}
	return new ShopkitApiError(fallbackMessage(request), status, error ?? null);
}

/**
 * The machine-readable part of a platform error: `details` / `context` (e.g.
 * which cart items are out of stock), or validation `errors`.
 */
function extractDetails(error: unknown): unknown {
	if (!error || typeof error !== "object") return null;
	const record = error as Record<string, unknown>;
	return record.details ?? record.context ?? record.errors ?? null;
}

function pickString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** A `message`, which validation errors send as a list of messages. */
function pickMessage(value: unknown): string | null {
	if (!Array.isArray(value)) return pickString(value);
	return pickString(
		value.filter((item) => typeof item === "string").join("; "),
	);
}

/** Drop empty values so an omitted option never becomes `?limit=undefined`. */
function buildQuery(
	query: TransportRequest["query"],
): Record<string, string> | undefined {
	if (!query) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "") continue;
		out[key] = String(value);
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Strip a `{ data, message, statusCode }` response envelope when present.
 *
 * Detection is structural, since some routes are wrapped and others are not.
 * A payload counts as an envelope only when `data` sits beside
 * `statusCode`/`message` and nothing else of substance, so a resource with its
 * own `data` field, or a paginated `{ data, has_more, next_cursor }`
 * collection, is never unwrapped.
 */
export function unwrapEnvelope<T>(payload: unknown): T {
	if (
		payload === null ||
		typeof payload !== "object" ||
		Array.isArray(payload)
	) {
		return payload as T;
	}
	const record = payload as ApiEnvelope<T> & Record<string, unknown>;
	if (!("data" in record)) return payload as T;
	const keys = Object.keys(record);
	// `meta` and `pricing` count as envelope keys only beside a `statusCode`;
	// a bare `{ data, meta }` is left alone like any other resource.
	const hasStatus = "statusCode" in record;
	const isEnvelope = keys.every(
		(key) =>
			key === "data" ||
			key === "message" ||
			key === "statusCode" ||
			key === "error" ||
			((key === "meta" || key === "pricing") && hasStatus),
	);
	if (!isEnvelope) return payload as T;
	const data = record.data;
	// A single product read states its pricing beside the product; carry it
	// onto the product (additively) rather than dropping it with the envelope.
	if (
		record.pricing !== undefined &&
		data !== null &&
		typeof data === "object" &&
		!Array.isArray(data) &&
		!("pricing" in data)
	) {
		return { ...data, pricing: record.pricing } as T;
	}
	return data as T;
}
