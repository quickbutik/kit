import type { SessionStore } from "../../state/session-store.js";
import type { CustomerAuth } from "../customer-auth.js";
import { ShopkitAuthError, ShopkitConfigError } from "../errors.js";
import type { ScopeGuard } from "../scopes.js";
import type { Transport } from "../transport.js";
import type { RequestOptions } from "../types/common.js";
import type {
	Customer,
	CustomerAccountsConfig,
	CustomerClub,
	CustomerLoginInput,
	CustomerPasswordResetInput,
	CustomerPasswordResetRequestInput,
	CustomerRegisterInput,
	CustomerRegisterResult,
	CustomerSession,
	CustomerSessionInput,
	CustomerState,
} from "../types/customer.js";

/**
 * Customer accounts: register, log in and out, reset a forgotten password,
 * the logged-in customer's profile and club points.
 *
 * Once a customer is logged in, the client sends their token with every
 * request on its own (catalog, cart, checkout), so prices and visibility
 * follow the customer's group. Callers never pass the token by hand.
 *
 * ```ts
 * const { customer } = await shopkit.customers.login({ email, password })
 * shopkit.customers.isLoggedIn          // true
 * await shopkit.products.list()         // priced for the customer's group
 * await shopkit.customers.logout()      // and back to a guest, with a fresh cart
 * ```
 */
export class CustomersResource {
	/** Club membership and points. */
	readonly club: {
		get: (options?: RequestOptions) => Promise<CustomerClub | null>;
	};
	private configPromise: Promise<CustomerAccountsConfig> | null = null;
	private profileRead: Promise<Customer | null> | null = null;

	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
		private readonly store: SessionStore,
		private readonly auth: CustomerAuth,
	) {
		this.club = { get: (options) => this.readClub(options) };
	}

	/**
	 * The shop's customer-account settings: whether login is on, and whether
	 * guests see prices and may add to cart. The same for every shopper, so it
	 * is read once per client.
	 */
	config(options: RequestOptions = {}): Promise<CustomerAccountsConfig> {
		// The settings are public shop configuration, so a key that can read
		// storefront content may read them too, without the session scope.
		if (!this.scopes.has("storefront:read")) {
			this.scopes.assert("customer:session", "customers.config()");
		}
		if (!this.configPromise) {
			const promise = this.transport.request<CustomerAccountsConfig>({
				method: "GET",
				path: "/shop/customer-accounts",
				signal: options.signal,
				customer: false,
				errorMessage: "shopkit: could not load customer-account settings",
			});
			promise.catch(() => {
				if (this.configPromise === promise) this.configPromise = null;
			});
			this.configPromise = promise;
		}
		return this.configPromise;
	}

	/**
	 * Log a customer in. The session is remembered in the client's storage
	 * and every later request is made as this customer. Throws a
	 * `ShopkitAuthError`: `invalid_credentials` (wrong email or password,
	 * never saying which), `customer_blocked`, `customer_login_disabled`,
	 * `rate_limited`.
	 *
	 * Logging in as a different customer than the one logged in before
	 * forgets the cart, which belongs to that other customer.
	 */
	async login(
		input: CustomerLoginInput,
		options: RequestOptions = {},
	): Promise<CustomerSession> {
		this.scopes.assert("customer:session", "customers.login()");
		const session = await this.transport.request<CustomerSession>({
			method: "POST",
			path: "/account/login",
			body: { email: input.email, password: input.password },
			signal: options.signal,
			customer: false,
			errorMessage: "shopkit: could not log in",
		});
		await this.auth.begin(session, session.customer ?? null);
		return session;
	}

	/**
	 * Create a customer account. Three outcomes, on `status`:
	 *
	 * - `logged_in`: a new email. The customer is logged in exactly as
	 *   `login()` would (session remembered, listeners told, another
	 *   customer's cart forgotten); the rest is the session.
	 * - `verification_required`: the email belongs to an earlier guest
	 *   customer. A code was emailed; finish with
	 *   `resetPassword({ email, code, password })`, which logs in.
	 * - `login_required`: the account was created but no session could be
	 *   opened. Send the shopper to `login()`.
	 *
	 * Throws a `ShopkitAuthError`: `signup_disabled` (the shop does not let
	 * shoppers register), `email_taken`, `invalid_email`, `invalid_name`,
	 * `invalid_password` (6 to 40 bytes, UTF-8, after removing HTML tags),
	 * `customer_login_disabled`, `rate_limited`. Check `config()` first:
	 * `login.signupAllowed` says whether to offer registration at all.
	 */
	async register(
		input: CustomerRegisterInput,
		options: RequestOptions = {},
	): Promise<CustomerRegisterResult> {
		this.scopes.assert("customer:session", "customers.register()");
		const response = await this.transport.request<
			CustomerSession | { verificationRequired: true } | { loginRequired: true }
		>({
			method: "POST",
			path: "/account/register",
			body: {
				email: input.email,
				password: input.password,
				firstName: input.firstName,
				lastName: input.lastName,
				companyName: input.companyName,
				companyNumber: input.companyNumber,
				clubOptIn: input.clubOptIn,
			},
			signal: options.signal,
			customer: false,
			errorMessage: "shopkit: could not register the customer",
		});
		if ("loginRequired" in response) return { status: "login_required" };
		if ("verificationRequired" in response) {
			return { status: "verification_required" };
		}
		await this.auth.begin(response, response.customer ?? null);
		return { status: "logged_in", ...response };
	}

	/**
	 * Email a one-time reset code to the account with this email. Resolves the
	 * same way whether or not such an account exists, so it never tells who
	 * has one. The code is valid for 30 minutes; a new request replaces it.
	 * Hand it to `resetPassword()`. Throws a `ShopkitAuthError` only for
	 * `customer_login_disabled` and `rate_limited`.
	 */
	async requestPasswordReset(
		input: CustomerPasswordResetRequestInput,
		options: RequestOptions = {},
	): Promise<void> {
		this.scopes.assert("customer:session", "customers.requestPasswordReset()");
		await this.transport.requestVoid({
			method: "POST",
			path: "/account/password/forgot",
			body: { email: input.email },
			signal: options.signal,
			customer: false,
			errorMessage: "shopkit: could not request a password reset",
		});
	}

	/**
	 * Set a new password with the code from the reset email, and log the
	 * customer in, exactly as `login()` would. Every other session of the
	 * customer ends. Throws a `ShopkitAuthError`:
	 * `password_changed_login_required` (the password WAS changed but no
	 * session could be opened: log in with it), `invalid_reset_code` (wrong,
	 * expired or used up, never saying which), `invalid_password` (as for
	 * `register()`), `customer_blocked`, `customer_login_disabled`,
	 * `rate_limited`.
	 */
	async resetPassword(
		input: CustomerPasswordResetInput,
		options: RequestOptions = {},
	): Promise<CustomerSession> {
		this.scopes.assert("customer:session", "customers.resetPassword()");
		const session = await this.transport.request<
			CustomerSession | { loginRequired: true }
		>({
			method: "POST",
			path: "/account/password/reset",
			body: {
				email: input.email,
				code: input.code,
				password: input.password,
			},
			signal: options.signal,
			customer: false,
			errorMessage: "shopkit: could not reset the password",
		});
		if ("loginRequired" in session) {
			throw new ShopkitAuthError(
				"shopkit: the password was changed; log in with the new password",
				200,
				"password_changed_login_required",
				session,
			);
		}
		await this.auth.begin(session, session.customer ?? null);
		return session;
	}

	/**
	 * Log out: revoke the session on the platform (best effort), then ALWAYS
	 * forget it locally along with the cart and the checkout session, which
	 * were the customer's. Never throws for a failed revoke: the shopper asked
	 * to be logged out, and on this device they are.
	 */
	async logout(): Promise<void> {
		const session = await this.auth.load().catch(() => null);
		try {
			if (session?.refreshToken && this.scopes.has("customer:session")) {
				await this.transport.requestVoid({
					method: "POST",
					path: "/account/logout",
					body: { refreshToken: session.refreshToken },
					customer: false,
					errorMessage: "shopkit: could not revoke the customer session",
				});
			}
		} catch {
			// The refresh token dies with its 30 days and the access token within
			// 15 minutes either way; the local session goes below.
		} finally {
			await this.store.clearCartId().catch(() => undefined);
			await this.store.clearCheckoutSessionId().catch(() => undefined);
			await this.auth.end();
		}
	}

	/**
	 * Whether a customer is logged in, without waiting on storage.
	 *
	 * Answered from memory, or from storage when the adapter answers
	 * synchronously (memory, `localStorage`, `document.cookie`, a request
	 * cookie jar). With an async-only adapter (Next's `cookies()`) it is false
	 * until the session has been read: `await getAccessToken()` first.
	 */
	get isLoggedIn(): boolean {
		return this.auth.peek() !== null;
	}

	/**
	 * The profile last returned by `login()`, `register()`, `resetPassword()`
	 * or `me()` in this client, or null. Use `me()` for a fresh read.
	 */
	get current(): Customer | null {
		return this.isLoggedIn ? this.auth.customer : null;
	}

	/**
	 * Who the client's requests are made for, as a short string: the
	 * customer id, or `anon`, plus a counter that moves on every login and
	 * logout. Key any cache of customer-priced data on it.
	 */
	get cacheKey(): string {
		const session = this.auth.peek();
		// `?` until an async adapter has been read: whatever is cached before
		// that is keyed apart from both the guest and the customer.
		const who = this.auth.loaded ? (session?.customerId ?? "anon") : "?";
		return `${this.auth.revision}:${who}`;
	}

	/**
	 * Be told when a customer logs in or out, or the session ends because the
	 * platform no longer accepts it. The listener gets null for "nobody".
	 * Returns an unsubscribe function. In a browser the same change is also
	 * dispatched on `document` as a `qb:customer` event.
	 */
	onChange(listener: (state: CustomerState | null) => void): () => void {
		return this.auth.subscribe(listener);
	}

	/**
	 * The logged-in customer's profile and group, or null when nobody is
	 * logged in (or the session ended, or changed hands, while it was read).
	 * Concurrent calls share one request; every `onChange` listener hears the
	 * new profile.
	 */
	async me(options: RequestOptions = {}): Promise<Customer | null> {
		this.scopes.assert("customer:session", "customers.me()");
		this.profileRead ??= this.readProfile(options).finally(() => {
			this.profileRead = null;
		});
		return this.profileRead;
	}

	private async readProfile(options: RequestOptions): Promise<Customer | null> {
		const customer = await this.readForSession<Customer>(
			"/account",
			"shopkit: could not load the customer",
			options,
		);
		if (customer) this.auth.setProfile(customer);
		return customer;
	}

	/**
	 * Adopt a session minted elsewhere: by your server, or a native app that
	 * logged in itself. `refreshToken` is optional; without it the session
	 * ends when the access token expires.
	 */
	setSession(input: CustomerSessionInput): Promise<void> {
		const invalid = invalidSessionInput(input);
		if (invalid) {
			return Promise.reject(
				new ShopkitConfigError(`shopkit: customers.setSession() ${invalid}`),
			);
		}
		return this.auth.begin(input, null);
	}

	/**
	 * A valid access token, renewed first when it expires within 30 seconds;
	 * null when nobody is logged in or the session could not be renewed. For
	 * handing the token to your own backend.
	 */
	getAccessToken(): Promise<string | null> {
		return this.auth.token();
	}

	private async readClub(
		options: RequestOptions = {},
	): Promise<CustomerClub | null> {
		this.scopes.assert("customer:session", "customers.club.get()");
		return this.readForSession<CustomerClub>(
			"/account/club",
			"shopkit: could not load the customer club",
			options,
		);
	}

	/**
	 * A GET as the logged-in customer, or null when nobody is logged in or the
	 * session ended or changed hands while it was out, so another customer's
	 * data never lands.
	 */
	private async readForSession<T>(
		path: string,
		errorMessage: string,
		options: RequestOptions,
	): Promise<T | null> {
		if (!(await this.auth.load())) return null;
		const revision = this.auth.revision;
		try {
			const data = await this.transport.request<T>({
				method: "GET",
				path,
				signal: options.signal,
				errorMessage,
			});
			return this.auth.revision === revision ? data : null;
		} catch (error) {
			if (isSessionGone(error)) return null;
			throw error;
		}
	}
}

/** Why a `setSession()` input is unusable, or null when it is fine. */
function invalidSessionInput(input: CustomerSessionInput): string | null {
	if (!input || typeof input.accessToken !== "string" || !input.accessToken) {
		return "needs a non-empty `accessToken` string.";
	}
	const { refreshToken } = input;
	if (
		refreshToken != null &&
		(typeof refreshToken !== "string" || refreshToken === "")
	) {
		return "needs `refreshToken` to be a non-empty string, or null.";
	}
	for (const key of [
		"accessTokenExpiresAt",
		"refreshTokenExpiresAt",
	] as const) {
		const value = input[key];
		if (
			value != null &&
			(typeof value !== "string" || Number.isNaN(Date.parse(value)))
		) {
			return `needs \`${key}\` to be an ISO 8601 date string, or null.`;
		}
	}
	return null;
}

/** The session ended under the request: the read answers "nobody". */
function isSessionGone(error: unknown): boolean {
	return (
		error instanceof ShopkitAuthError &&
		(error.code === "customer_token_required" ||
			error.code === "customer_token_invalid" ||
			error.code === "customer_token_expired")
	);
}
