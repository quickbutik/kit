import type { CountryCode, CurrencyCode } from "./common.js";

/** How shoppers become members of the customer club. */
export type CustomerClubJoinMethod =
	| "registration"
	| "auto"
	| "manual"
	| "auto_and_registration";

/**
 * The shop's customer-account settings, public and the same for every
 * shopper: whether login is on at all, and what a guest may see.
 */
export interface CustomerAccountsConfig {
	login: {
		/** Customer login is switched on for the shop. */
		enabled: boolean;
		/** Shoppers may create their own account with `customers.register()`. */
		signupAllowed: boolean;
		/** Guests see no prices: amounts come back `null` with `hidden: true`. */
		hidePricesForGuests: boolean;
		/** Guests cannot add to cart: the cart answers 403 `login_required`. */
		hideAddToCartForGuests: boolean;
	};
	customerGroups: { enabled: boolean };
	customerClub: { enabled: boolean; joinMethod: CustomerClubJoinMethod };
}

export interface CustomerAddress {
	line1: string | null;
	line2: string | null;
	postalCode: string | null;
	city: string | null;
	country: CountryCode | null;
}

/** The customer group whose prices a logged-in customer sees. */
export interface CustomerGroup {
	id: number;
	name: string;
	/**
	 * How the shop shows this group's prices. A display hint only: amounts
	 * are the same either way.
	 */
	priceVatDisplay: "incl" | "excl";
}

/**
 * The logged-in customer, as `customers.me()`, `customers.login()`,
 * `customers.register()` and `customers.resetPassword()` return it.
 */
export interface Customer {
	id: number;
	email: string;
	firstName: string | null;
	lastName: string | null;
	phone: string | null;
	isCompany: boolean;
	companyName: string | null;
	companyNumber: string | null;
	address: CustomerAddress | null;
	/** The customer's group, or null when the customer is in none. */
	group: CustomerGroup | null;
}

/** `customers.login()` input. */
export interface CustomerLoginInput {
	email: string;
	password: string;
}

/** `customers.register()` input. */
export interface CustomerRegisterInput {
	email: string;
	/** 6 to 40 bytes (UTF-8; å, ä and ö count as 2), after removing HTML tags. */
	password: string;
	firstName: string;
	lastName: string;
	/** A non-empty name registers a company customer. */
	companyName?: string;
	/** The company's registration number, for a company customer. */
	companyNumber?: string;
	/**
	 * Join the customer club too, when the shop's club takes members at
	 * registration (`customerClub.joinMethod` is `registration` or
	 * `auto_and_registration`). Ignored otherwise.
	 */
	clubOptIn?: boolean;
}

/**
 * What `customers.register()` resolves with. `logged_in`: the session, now
 * remembered by the client. `verification_required`: the email belongs to an
 * earlier guest customer; a code was emailed, and
 * `customers.resetPassword({ email, code, password })` finishes the
 * registration and logs in. `login_required`: the account was created but no
 * session could be opened; send the shopper to `customers.login()`.
 */
export type CustomerRegisterResult =
	| ({ status: "logged_in" } & CustomerSession)
	| { status: "verification_required" }
	| { status: "login_required" };

/** `customers.requestPasswordReset()` input. */
export interface CustomerPasswordResetRequestInput {
	email: string;
}

/** `customers.resetPassword()` input. */
export interface CustomerPasswordResetInput {
	email: string;
	/**
	 * The one-time code from the reset email. Case, spaces and dashes do not
	 * matter.
	 */
	code: string;
	/** The new password; same rules as {@link CustomerRegisterInput.password}. */
	password: string;
}

/**
 * A customer session as the platform issues it: a short-lived access token
 * (15 minutes) and a rotating refresh token (30 days). The kit keeps both and
 * renews the access token on its own.
 */
export interface CustomerSession {
	accessToken: string;
	/** ISO 8601. */
	accessTokenExpiresAt: string;
	refreshToken: string;
	/** ISO 8601. */
	refreshTokenExpiresAt: string;
	customer: Customer;
}

/**
 * A session handed to `customers.setSession()`: one minted somewhere else (a
 * server, a native app). Expiries are optional; the access token's own `exp`
 * claim is used when `accessTokenExpiresAt` is missing.
 */
export interface CustomerSessionInput {
	accessToken: string;
	refreshToken?: string | null;
	accessTokenExpiresAt?: string | null;
	refreshTokenExpiresAt?: string | null;
}

/**
 * What `customers.onChange()` listeners and the `qb:customer` DOM event get:
 * null when nobody is logged in, else the customer's id and, when this client
 * has it, their profile. A session set with `setSession()` has an id and no
 * profile until `me()` reads it.
 */
export interface CustomerState {
	/** The customer id from the access token (`sub`). */
	customerId: string | null;
	customer: Customer | null;
}

/** The logged-in customer's club membership and points. */
export interface CustomerClub {
	member: boolean;
	active: boolean;
	points: { balance: number; lifetime: number };
	/** Progress towards the next reward code. */
	reward: { targetPoints: number; remaining: number };
	/** Points earned per unit of the request's currency. */
	earning: { pointsPerUnit: number; currency: CurrencyCode };
}
