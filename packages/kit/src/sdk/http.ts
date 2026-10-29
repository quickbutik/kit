/**
 * The HTTP layer under {@link Transport}: one `fetch` per attempt, with the
 * publishable key, the pinned API version, an `Idempotency-Key` on every
 * mutation, a timeout per attempt, retries with backoff, and rate-limit
 * pacing. It knows nothing about shopkit's errors or envelopes — it returns
 * the response and its parsed body, and throws only when no response arrived.
 */

/**
 * The API version every request pins with `QB-Version`. The platform keeps
 * serving this version's response shapes until it is sunset, so bumping it
 * is how the kit opts into renamed fields — deliberately, with the types.
 */
export const API_VERSION = "2026-03-01";

export interface HttpClientOptions {
	/** Origin plus version, e.g. `https://api.quickbutik.com/v2`. */
	baseUrl: string;
	/** Sent as `Authorization: Bearer <token>`. */
	token: string;
	fetch: typeof globalThis.fetch;
	/** Budget for each attempt, not for the request as a whole. */
	timeoutMs: number;
	/** Extra attempts after the first; 0 disables retries. */
	maxRetries: number;
	/** First backoff delay; each later one doubles, with jitter. */
	retryBaseDelayMs: number;
	/** Set on every request after the kit's own, except `Authorization`. */
	headers: Record<string, string>;
}

export interface HttpRequest {
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	/** Path relative to `baseUrl`, e.g. `/checkout/sessions`. */
	path: string;
	query?: Record<string, string>;
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface HttpResponse {
	response: Response;
	/**
	 * A success body parsed by its content type (`{}` when empty). An error
	 * body as JSON when it parses, its text when not — a proxy's HTML page.
	 */
	body: unknown;
}

const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH"]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 60_000;
/** A 429 is never retried sooner than this, whatever `Retry-After` says. */
const MIN_RATE_LIMIT_DELAY_MS = 1_000;
const JITTER = 0.25;
/** Pause before a request once this few remain in the rate-limit window. */
const PACING_THRESHOLD = 2;
const PACING_BUFFER_MS = 150;

export class HttpClient {
	private token: string;
	private rateLimit: { remaining: number; resetsAt: number } | null = null;

	constructor(private readonly options: HttpClientOptions) {
		this.token = options.token;
	}

	/** Send later requests with a different bearer token (a rotated key). */
	setToken(token: string): void {
		this.token = token;
	}

	/** Send a request, retrying when it is safe to. Throws on network failure. */
	async send(request: HttpRequest): Promise<HttpResponse> {
		const url = this.buildUrl(request);
		const body =
			request.body === undefined ? undefined : serializeBody(request.body);
		// Made once, outside the retry loop, so every attempt shares the key and
		// the platform can recognise a retried mutation as the same one.
		const headers = this.buildHeaders(request, body !== undefined);

		for (let attempt = 0; ; attempt++) {
			const canRetry = attempt < this.options.maxRetries;
			let response: Response;
			try {
				response = await this.attempt(url, {
					method: request.method,
					headers,
					body,
					signal: request.signal,
				});
			} catch (error) {
				if (!canRetry || request.signal?.aborted) throw error;
				await sleep(backoff(attempt, this.options.retryBaseDelayMs));
				continue;
			}
			if (canRetry && RETRYABLE_STATUSES.has(response.status)) {
				await response.body?.cancel().catch(() => {});
				await sleep(this.retryDelay(response, attempt));
				continue;
			}
			return { response, body: await readBody(response) };
		}
	}

	private buildUrl(request: HttpRequest): string {
		const url = `${this.options.baseUrl}${request.path}`;
		const query = Object.entries(request.query ?? {})
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join("&");
		return query ? `${url}?${query}` : url;
	}

	private buildHeaders(request: HttpRequest, hasBody: boolean): Headers {
		const headers = new Headers({ "QB-Version": API_VERSION });
		if (hasBody) headers.set("Content-Type", "application/json");
		for (const [name, value] of Object.entries(request.headers ?? {})) {
			headers.set(name, value);
		}
		if (IDEMPOTENT_METHODS.has(request.method)) {
			headers.set("Idempotency-Key", crypto.randomUUID());
		}
		for (const [name, value] of Object.entries(this.options.headers)) {
			if (name.toLowerCase() !== "authorization") headers.set(name, value);
		}
		return headers;
	}

	/** One fetch under its own timeout, after any rate-limit pause. */
	private async attempt(url: string, init: RequestInit): Promise<Response> {
		await this.pace();
		const headers = new Headers(init.headers);
		// Read per attempt: a key rotated mid-retry applies to the next attempt.
		headers.set("Authorization", `Bearer ${this.token}`);
		const { signal, release } = withTimeout(
			init.signal ?? undefined,
			this.options.timeoutMs,
		);
		try {
			const response = await this.options.fetch(url, {
				...init,
				headers,
				signal,
			});
			this.observeRateLimit(response);
			return response;
		} finally {
			release();
		}
	}

	/**
	 * Wait out the window when the last response said it is nearly spent, so
	 * a burst of requests slows down instead of running into 429s.
	 */
	private async pace(): Promise<void> {
		const limit = this.rateLimit;
		if (!limit || limit.remaining > PACING_THRESHOLD) return;
		this.rateLimit = null;
		const wait = limit.resetsAt - Date.now();
		if (wait > 0) {
			await sleep(Math.min(wait + PACING_BUFFER_MS, MAX_RETRY_DELAY_MS));
		}
	}

	private observeRateLimit(response: Response): void {
		const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
		const reset = Number(response.headers.get("X-RateLimit-Reset"));
		if (
			response.headers.has("X-RateLimit-Remaining") &&
			Number.isFinite(remaining) &&
			Number.isFinite(reset) &&
			reset > 0
		) {
			this.rateLimit = { remaining, resetsAt: reset * 1000 };
		}
	}

	private retryDelay(response: Response, attempt: number): number {
		const computed = backoff(attempt, this.options.retryBaseDelayMs);
		if (response.status !== 429) return computed;
		const seconds = Number(response.headers.get("Retry-After") ?? Number.NaN);
		const delay =
			Number.isFinite(seconds) && seconds >= 0
				? Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
				: computed;
		return Math.max(MIN_RATE_LIMIT_DELAY_MS, delay);
	}
}

function serializeBody(body: unknown): string {
	return JSON.stringify(body, (_key, value) =>
		typeof value === "bigint" ? value.toString() : value,
	);
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!response.ok) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	const type = response.headers.get("Content-Type")?.split(";")[0]?.trim();
	if (type && !type.startsWith("application/json") && !type.endsWith("+json")) {
		return text;
	}
	return text ? JSON.parse(text) : {};
}

/** Exponential backoff with ±25 % jitter, so retrying clients spread out. */
function backoff(attempt: number, baseMs: number): number {
	const delay = Math.min(baseMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
	return Math.max(0, delay + delay * JITTER * (2 * Math.random() - 1));
}

/**
 * A signal that aborts on the caller's signal or after `ms`. Hand-rolled
 * rather than `AbortSignal.any`, which Node 18 lacks.
 */
function withTimeout(
	caller: AbortSignal | undefined,
	ms: number,
): { signal: AbortSignal; release: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	const onAbort = () => controller.abort(caller?.reason);
	if (caller?.aborted) controller.abort(caller.reason);
	else caller?.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		release: () => {
			clearTimeout(timer);
			caller?.removeEventListener("abort", onAbort);
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
