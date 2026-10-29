/** Base class for everything shopkit throws, so `catch` can narrow on one type. */
export class ShopkitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ShopkitError";
	}
}

/** A bad `createShopkitClient` config — a malformed key, a missing apiUrl. */
export class ShopkitConfigError extends ShopkitError {
	constructor(message: string) {
		super(message);
		this.name = "ShopkitConfigError";
	}
}

/**
 * A call was made that the client's declared scopes do not cover. Thrown
 * locally, before the request goes out, so the missing scope is named instead
 * of surfacing as an opaque 403.
 */
export class ShopkitScopeError extends ShopkitError {
	constructor(
		readonly required: string,
		readonly declared: readonly string[],
		operation: string,
	) {
		super(
			`shopkit: ${operation} requires the "${required}" scope. ` +
				`The client was created with scopes [${declared.join(", ") || "none"}]. ` +
				`Add it to \`scopes\` and make sure the publishable key itself carries it.`,
		);
		this.name = "ShopkitScopeError";
	}
}

/** A non-2xx response from the Quickbutik API. */
export class ShopkitApiError extends ShopkitError {
	constructor(
		message: string,
		readonly status: number,
		/** Parsed response body when it was JSON, else the raw text, else null. */
		readonly body: unknown = null,
		/** `details` / `context` from the platform's error envelope, when present. */
		readonly details: unknown = null,
		/**
		 * The platform's stable machine-readable `code` (`invalid_credentials`,
		 * `cart_customer_mismatch`, …), from either error envelope; null when
		 * the response carried none.
		 */
		readonly code: string | null = null,
	) {
		super(message);
		this.name = "ShopkitApiError";
	}

	/** True for the statuses where retrying the same request can plausibly help. */
	get retryable(): boolean {
		return this.status === 408 || this.status === 429 || this.status >= 500;
	}

	static async fromResponse(
		response: Response,
		fallbackMessage: string,
	): Promise<ShopkitApiError> {
		const text = await response.text().catch(() => "");
		if (!text) return new ShopkitApiError(fallbackMessage, response.status);

		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// Not JSON — an HTML error page from a proxy, most likely. Keep the text.
			return new ShopkitApiError(fallbackMessage, response.status, text);
		}

		const record = body as Record<string, unknown> | null;
		// Either `{ message, statusCode }` or RFC 9457 problem+json `{ title, detail }`.
		const message =
			pickString(record?.message) ??
			pickString(record?.detail) ??
			pickString(record?.title) ??
			pickString(record?.error) ??
			fallbackMessage;
		const details = record?.details ?? record?.context ?? null;
		return createApiError(
			message,
			response.status,
			body,
			details,
			readErrorCode(body),
		);
	}
}

/**
 * The customer-account error codes. A response carrying one of these is
 * thrown as a {@link ShopkitAuthError}; so is `rate_limited` from a
 * customer-account call (`/account/*`), while any other 429 stays a plain
 * `ShopkitApiError`.
 */
export const CUSTOMER_AUTH_ERROR_CODES = [
	"invalid_credentials",
	"customer_blocked",
	"customer_login_disabled",
	"customer_token_expired",
	"customer_token_invalid",
	"customer_token_required",
	"customer_token_shop_mismatch",
	"customer_club_disabled",
	"cart_customer_mismatch",
	"login_required",
	"signup_disabled",
	"email_taken",
	"invalid_email",
	"invalid_name",
	"invalid_password",
	"invalid_reset_code",
] as const;

export type CustomerAuthErrorCode =
	| (typeof CUSTOMER_AUTH_ERROR_CODES)[number]
	| "rate_limited"
	// Kit-side: `resetPassword()` changed the password but got no session.
	| "password_changed_login_required";

/**
 * A customer-account refusal: wrong credentials, a blocked customer, a
 * session the platform no longer accepts, a cart that belongs to another
 * customer. `code` says which; `status` is the HTTP status as usual.
 *
 * ```ts
 * try {
 *   await shopkit.customers.login({ email, password })
 * } catch (error) {
 *   if (error instanceof ShopkitAuthError && error.code === "invalid_credentials") …
 * }
 * ```
 */
export class ShopkitAuthError extends ShopkitApiError {
	declare readonly code: CustomerAuthErrorCode;

	constructor(
		message: string,
		status: number,
		code: CustomerAuthErrorCode,
		body: unknown = null,
		details: unknown = null,
	) {
		super(message, status, body, details, code);
		this.name = "ShopkitAuthError";
	}
}

export function isCustomerAuthErrorCode(
	code: unknown,
): code is CustomerAuthErrorCode {
	return (CUSTOMER_AUTH_ERROR_CODES as readonly unknown[]).includes(code);
}

/**
 * A ShopkitApiError, or a ShopkitAuthError when `code` is a customer one.
 * `path` (the request's, when known) decides whether a `rate_limited` is a
 * login limit or the ordinary API one.
 */
export function createApiError(
	message: string,
	status: number,
	body: unknown,
	details: unknown,
	code: string | null,
	path = "",
): ShopkitApiError {
	return isCustomerAuthErrorCode(code) ||
		(code === "rate_limited" && path.startsWith("/account"))
		? new ShopkitAuthError(
				message,
				status,
				code as CustomerAuthErrorCode,
				body,
				details,
			)
		: new ShopkitApiError(message, status, body, details, code);
}

/**
 * A remembered cart this shopper can no longer use: it belongs to a customer
 * who is not (or no longer) the one making the request. Treated like a cart
 * that is gone, so the id is forgotten instead of failing every read.
 */
export function isUnusableCartError(error: unknown): boolean {
	return (
		error instanceof ShopkitAuthError &&
		(error.code === "customer_token_required" ||
			error.code === "cart_customer_mismatch")
	);
}

/**
 * The `code` of a platform error body, whichever envelope it came in
 * (`{ statusCode, message, code }` or problem+json), at the top level or
 * nested under `error`.
 */
export function readErrorCode(body: unknown): string | null {
	if (!body || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;
	const direct = pickString(record.code);
	if (direct) return direct;
	const nested = record.error;
	if (nested && typeof nested === "object") {
		return pickString((nested as Record<string, unknown>).code);
	}
	return null;
}

/** The request never produced a response (offline, DNS, abort, timeout). */
export class ShopkitNetworkError extends ShopkitError {
	constructor(
		message: string,
		readonly cause: unknown,
	) {
		super(message);
		this.name = "ShopkitNetworkError";
	}
}

function pickString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
