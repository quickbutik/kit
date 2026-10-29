import type { ScopeGuard } from "../scopes.js";
import type { Transport } from "../transport.js";
import type { RequestOptions } from "../types/common.js";
import type {
	NewsletterSettings,
	NewsletterSubscribeInput,
} from "../types/newsletter.js";

/**
 * Newsletter sign-up: whether the shop takes sign-ups, and subscribing a
 * shopper's email to the merchant's newsletter provider (GetaNewsletter,
 * Mailchimp or Rule).
 *
 * Anonymous by design: no customer token is sent, logged in or not.
 *
 * ```ts
 * if (await shopkit.newsletter.isEnabled()) showSignupForm()
 * await shopkit.newsletter.subscribe({ email })
 * ```
 */
export class NewsletterResource {
	private enabledPromise: Promise<boolean> | null = null;

	constructor(
		private readonly transport: Transport,
		private readonly scopes: ScopeGuard,
	) {}

	/**
	 * Whether the shop takes newsletter sign-ups: the newsletter app is on AND
	 * a provider is configured, so `subscribe()` is not refused as
	 * `newsletter_disabled`. The gate for rendering a sign-up form. Stricter
	 * than `Shop.newsletterEnabled`, which only says the app is on. The same
	 * for every shopper, so it is read once per client.
	 */
	isEnabled(options: RequestOptions = {}): Promise<boolean> {
		// Public shop configuration, so a key that can read storefront content
		// may read it too, without the sign-up scope.
		if (!this.scopes.has("storefront:read")) {
			this.scopes.assert("newsletter:subscribe", "newsletter.isEnabled()");
		}
		if (!this.enabledPromise) {
			const promise = this.transport
				.request<NewsletterSettings>({
					method: "GET",
					path: "/shop/newsletter",
					signal: options.signal,
					customer: false,
					errorMessage: "shopkit: could not load newsletter settings",
				})
				.then((settings) => settings.enabled === true);
			promise.catch(() => {
				if (this.enabledPromise === promise) this.enabledPromise = null;
			});
			this.enabledPromise = promise;
		}
		return this.enabledPromise;
	}

	/**
	 * Subscribe an email to the shop's newsletter. Resolves once the address
	 * has been handed to the merchant's provider. Quickbutik keeps no
	 * subscriber list and adds no double opt-in step of its own: the provider
	 * adds the address or updates the contact it has, so an address already
	 * subscribed succeeds again.
	 *
	 * Throws a `ShopkitApiError` with `code`: `newsletter_invalid_email`
	 * (422), `newsletter_disabled` (409; check `isEnabled()` first),
	 * `newsletter_subscribe_failed` (502, the provider refused the address or
	 * could not be reached; try again later), `rate_limited` (429). A missing
	 * or too long field is a 400, with the fields in `details`.
	 */
	async subscribe(
		input: NewsletterSubscribeInput,
		options: RequestOptions = {},
	): Promise<void> {
		this.scopes.assert("newsletter:subscribe", "newsletter.subscribe()");
		await this.transport.requestVoid({
			method: "POST",
			path: "/newsletter/subscribe",
			body: {
				email: input.email,
				firstName: input.firstName,
				lastName: input.lastName,
			},
			signal: options.signal,
			// A sign-up is not a customer operation: it must neither carry nor
			// renew a logged-in customer's session.
			customer: false,
			errorMessage: "shopkit: could not subscribe to the newsletter",
		});
	}
}
