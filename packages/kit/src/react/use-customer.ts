"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ShopkitClient } from "../sdk/client.js";
import type {
	Customer,
	CustomerClub,
	CustomerLoginInput,
	CustomerPasswordResetInput,
	CustomerPasswordResetRequestInput,
	CustomerRegisterInput,
	CustomerRegisterResult,
	CustomerSession,
} from "../sdk/types/customer.js";
import { useShopkit } from "./context.js";
import { type AsyncState, useAsync } from "./use-async.js";

/**
 * Who the client's requests are made for (`customers.cacheKey`), re-rendering
 * on every login and logout. The catalog hooks list it as a dependency so a
 * login refetches group prices and a logout drops them.
 */
export function useClientCustomerKey(client: ShopkitClient | null): string {
	const subscribe = useCallback(
		(notify: () => void) => client?.customers.onChange(notify) ?? (() => {}),
		[client],
	);
	const snapshot = () => client?.customers.cacheKey ?? "";
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface UseCustomerResult {
	/** The logged-in customer's profile, or null (a guest, or not read yet). */
	customer: Customer | null;
	isLoggedIn: boolean;
	/**
	 * True while a login, registration, password reset, logout or profile
	 * read is in flight.
	 */
	loading: boolean;
	/** The last of those calls' failure; cleared by the next attempt. */
	error: Error | null;
	/**
	 * Log in. Resolves with the session and rejects with the
	 * `ShopkitAuthError` (`invalid_credentials`, `customer_blocked`, …), which
	 * is also put on `error`.
	 */
	login: (input: CustomerLoginInput) => Promise<CustomerSession>;
	/**
	 * Create an account: `status` is `logged_in` (with the session),
	 * `verification_required` (an emailed code, finished with `resetPassword`),
	 * or `login_required` (created, log in). Rejects with the `ShopkitAuthError`
	 * (`email_taken`, `invalid_password`, `signup_disabled`, …), also on `error`.
	 */
	register: (input: CustomerRegisterInput) => Promise<CustomerRegisterResult>;
	/**
	 * Email a reset code. Resolves whether or not the account exists; rejects
	 * only for `customer_login_disabled` or `rate_limited`, also on `error`.
	 */
	requestPasswordReset: (
		input: CustomerPasswordResetRequestInput,
	) => Promise<void>;
	/**
	 * Set a new password with the emailed code and log in. Rejects with the
	 * `ShopkitAuthError` (`invalid_reset_code`, `invalid_password`, …), also
	 * on `error`.
	 */
	resetPassword: (
		input: CustomerPasswordResetInput,
	) => Promise<CustomerSession>;
	/** Log out; also forgets the cart. Never rejects. */
	logout: () => Promise<void>;
	/** Re-read the profile (`customers.me()`). */
	refresh: () => Promise<Customer | null>;
}

/**
 * The logged-in customer, with login, registration, password reset and
 * logout.
 *
 * ```tsx
 * const { customer, isLoggedIn, login, logout, error } = useCustomer()
 * if (!isLoggedIn) return <LoginForm onSubmit={login} error={error} />
 * return <button onClick={logout}>Log out {customer?.firstName}</button>
 * ```
 *
 * The profile is read once when a session is found without one (a reload,
 * or a session set with `setSession()`). Every catalog hook and `useCart()`
 * refetch on login and logout on their own.
 */
export function useCustomer(): UseCustomerResult {
	const client = useShopkit();
	useClientCustomerKey(client);
	const customers = client.customers;
	const isLoggedIn = customers.isLoggedIn;
	// Subscribed, so every caller re-renders when a new profile is read.
	const subscribe = useCallback(
		(notify: () => void) => customers.onChange(notify),
		[customers],
	);
	const read = () => customers.current;
	const customer = useSyncExternalStore(subscribe, read, read);
	const [pending, setPending] = useState(0);
	const [error, setError] = useState<Error | null>(null);

	const track = useCallback(
		async <T>(operation: () => Promise<T>): Promise<T> => {
			setPending((n) => n + 1);
			setError(null);
			try {
				return await operation();
			} catch (cause) {
				setError(cause instanceof Error ? cause : new Error(String(cause)));
				throw cause;
			} finally {
				setPending((n) => n - 1);
			}
		},
		[],
	);

	const refresh = useCallback(
		() => track(() => customers.me()),
		[customers, track],
	);

	const needsProfile = isLoggedIn && customer === null;
	useEffect(() => {
		if (needsProfile) refresh().catch(() => undefined);
	}, [needsProfile, refresh]);

	const login = useCallback(
		(input: CustomerLoginInput) => track(() => customers.login(input)),
		[customers, track],
	);
	const register = useCallback(
		(input: CustomerRegisterInput) => track(() => customers.register(input)),
		[customers, track],
	);
	const requestPasswordReset = useCallback(
		(input: CustomerPasswordResetRequestInput) =>
			track(() => customers.requestPasswordReset(input)),
		[customers, track],
	);
	const resetPassword = useCallback(
		(input: CustomerPasswordResetInput) =>
			track(() => customers.resetPassword(input)),
		[customers, track],
	);
	const logout = useCallback(
		() => track(() => customers.logout()),
		[customers, track],
	);

	return {
		customer,
		isLoggedIn,
		loading: pending > 0,
		error,
		login,
		register,
		requestPasswordReset,
		resetPassword,
		logout,
		refresh,
	};
}

/**
 * The logged-in customer's club membership and points; `data` is null for a
 * guest. Refetched on login and logout.
 *
 * ```tsx
 * const { data: club } = useCustomerClub()
 * club?.member && <p>{club.points.balance} points, {club.reward.remaining} to go</p>
 * ```
 *
 * A shop without the club app answers with a `ShopkitAuthError` whose code
 * is `customer_club_disabled`, on `error`.
 */
export function useCustomerClub(): AsyncState<CustomerClub | null> {
	const client = useShopkit();
	const key = useClientCustomerKey(client);
	const isLoggedIn = client.customers.isLoggedIn;
	const state = useAsync(
		(signal) => client.customers.club.get({ signal }),
		[client, key],
		{ enabled: isLoggedIn },
	);
	return isLoggedIn ? state : { ...state, data: null, error: null };
}
