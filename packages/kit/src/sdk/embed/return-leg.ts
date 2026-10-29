/**
 * The landing half of the redirect break-out, shared by every surface that
 * mounts an embedded checkout.
 *
 * A redirect payment method (Klarna, Swish, iDEAL, a full-page 3-D Secure, …)
 * takes the whole window to the provider, and the shopper comes back to the
 * page that created the session with
 * `?qb_checkout_session=<id>&qb_checkout_shop=<n>` appended. That page must
 * resume the session rather than create a new one.
 *
 * Both ids ride the URL because storage cannot be relied on: the cart, and the
 * store id remembered with it, are usually gone once the order is created.
 * Read both values on load and resume with them; strip them from the URL only
 * once the resumed frame has said `ready`.
 */

/** The parameter the checkout's return route appends to the merchant's page. */
export const CHECKOUT_SESSION_PARAM = "qb_checkout_session";

/**
 * The shop's numeric id, appended next to {@link CHECKOUT_SESSION_PARAM}, so
 * the return leg can build `/embed/{storeId}/{sessionId}` without storage.
 */
export const CHECKOUT_SHOP_PARAM = "qb_checkout_shop";

/** What the checkout's return route put on this page's URL. */
export interface ReturnedCheckout {
	/** The session to resume. */
	sessionId: string;
	/**
	 * The shop's numeric id, or null when the URL carries no usable one. Pass
	 * it to `checkout.resume()` as `storeId`; with null, resume falls back to
	 * the id remembered in storage.
	 */
	storeId: string | null;
}

/**
 * The session and shop the return leg put on the URL, or null when this is not
 * a return leg.
 *
 * Reads this page's URL by default; pass a request's URL to decide
 * server-side. Read-only, so safe to call during a render. A shop id that is
 * not an integer reads as null.
 */
export function readReturnedCheckout(
	url?: string | URL,
): ReturnedCheckout | null {
	const params = searchParamsOf(url);
	if (!params) return null;
	const sessionId = params.get(CHECKOUT_SESSION_PARAM);
	if (sessionId === null || sessionId === "") return null;
	const shop = params.get(CHECKOUT_SHOP_PARAM)?.trim() ?? "";
	return { sessionId, storeId: /^\d+$/.test(shop) ? shop : null };
}

/**
 * The session id on this page's URL, or null. Read-only. Prefer
 * {@link readReturnedCheckout}, which also returns the shop id, when the value
 * is going into `checkout.resume()`.
 */
export function readReturnedSessionId(): string | null {
	return readReturnedCheckout()?.sessionId ?? null;
}

/**
 * Take the kit's two parameters off the URL, leaving everything else.
 *
 * Call it once the resumed frame has said `ready`, not before: after that a
 * reload should not re-mount the paid session, but a resume that fails before
 * `ready` should leave the parameters so a reload resumes again. Uses
 * `replaceState`, and is a no-op when neither parameter is present.
 */
export function stripReturnedSessionId(): void {
	if (typeof window === "undefined") return;
	const params = new URLSearchParams(window.location.search);
	if (!params.has(CHECKOUT_SESSION_PARAM) && !params.has(CHECKOUT_SHOP_PARAM)) {
		return;
	}
	params.delete(CHECKOUT_SESSION_PARAM);
	params.delete(CHECKOUT_SHOP_PARAM);
	const query = params.toString();
	const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
	try {
		window.history.replaceState(window.history.state, "", next);
	} catch {
		// A `file://` page, or a history API a browser extension has taken over.
		// The parameters staying in the URL is cosmetic; resuming is not.
	}
}

/**
 * Read and strip in one step, for a hand-built host that does not wait for the
 * frame's `ready`. Prefer {@link readReturnedCheckout} on load and
 * {@link stripReturnedSessionId} on `ready`, so a resume that fails before the
 * frame answers can be retried by a reload.
 *
 * A second call returns null. Returns the session id only; read the shop id
 * with {@link readReturnedCheckout} before calling this.
 */
export function consumeReturnedSessionId(): string | null {
	const sessionId = readReturnedSessionId();
	if (sessionId === null) return null;
	stripReturnedSessionId();
	return sessionId;
}

/** The query of `url`, or of this page; null where there is neither. */
function searchParamsOf(url: string | URL | undefined): URLSearchParams | null {
	if (url !== undefined) {
		try {
			// The base only matters for a relative string; an absolute URL or a
			// `URL` instance ignores it.
			return new URL(String(url), "http://localhost").searchParams;
		} catch {
			return null;
		}
	}
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search);
}
