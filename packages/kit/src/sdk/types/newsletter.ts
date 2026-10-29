/** `newsletter.subscribe()` input: the shopper signing up. */
export interface NewsletterSubscribeInput {
	/**
	 * The address to subscribe, at most 254 characters. Trimmed by the
	 * platform; an address that is not a valid email is refused with
	 * `newsletter_invalid_email`.
	 */
	email: string;
	/**
	 * Passed to the shop's newsletter provider with the address. At most 100
	 * characters, trimmed; a blank name is the same as none.
	 */
	firstName?: string;
	/** As for `firstName`. */
	lastName?: string;
}

/**
 * The shop's public newsletter settings, as the platform serves them.
 * `newsletter.isEnabled()` answers with `enabled`.
 */
export interface NewsletterSettings {
	/**
	 * The newsletter app is on and a provider is configured, so a subscribe
	 * is not refused with `newsletter_disabled`.
	 */
	enabled: boolean;
}
