import type { CommerceEventParams } from "../analytics/events.js";
import type { EmbeddedCheckout } from "../sdk/embed/bridge.js";
import {
	type ReturnedCheckout,
	readReturnedCheckout,
	readReturnedSessionId,
	stripReturnedSessionId,
} from "../sdk/embed/return-leg.js";
import { QbElement } from "./base.js";
import { absolute, checkoutTheme } from "./checkout.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-checkout>` — the Quickbutik checkout, inside your own page.
 *
 * ```html
 * <qb-checkout success-url="/thanks" back-url="/cart" lang="sv"></qb-checkout>
 * ```
 *
 * Adds one `<iframe>` served from the checkout's own origin, so payments,
 * 3-D Secure and wallets work exactly as on the redirect checkout. Use
 * `<qb-checkout-button>` instead for a cart page that hands the shopper off;
 * it is also what this element falls back to. Attributes are read once, when
 * the session is created. `theme="light|dark"` overrides the shop's theme
 * (see {@link checkoutTheme}).
 *
 * 1. **The frame's height follows its content.** `min-height` is the floor.
 * 2. **Redirect payment methods break out to the top window.** Klarna, Swish,
 *    3-D Secure and the like return to this page with
 *    `?qb_checkout_session=…&qb_checkout_shop=…`; the element resumes that
 *    session and strips the parameters once the frame has answered, so a
 *    reload never resumes a consumed session.
 * 3. **It degrades rather than strands the shopper.** A shop on the legacy
 *    checkout, no embed URL, a page that cannot navigate its top window, or a
 *    frame that does not answer within 15 seconds
 *    (`detail.reason === "handshake-timeout"`) all fall back to the redirect
 *    checkout with `qb:checkout-fallback`, never `state="error"`.
 * 4. **It follows the cart.** Cart changes made from the page re-price the
 *    checkout. Nothing is mounted while the cart is empty or loading
 *    (`qb:checkout-empty` fires once), and emptying the cart takes the frame
 *    down, except while resuming a return leg or showing a completed order.
 *
 * Events, all bubbling: `qb:checkout-ready`, `qb:checkout-step`,
 * `qb:checkout-event` (GA4-shaped commerce events for your own dataLayer),
 * `qb:checkout-complete`, `qb:checkout-error`, `qb:checkout-fallback`, and
 * `qb:checkout-empty` when there is nothing in the cart to check out.
 */
export class QbCheckoutElement extends QbElement {
	/**
	 * Deliberately empty: attributes are read once, when the session is
	 * created, because re-reading one would tear down a checkout the shopper
	 * may be paying in. Set them before the element connects.
	 */
	static observedAttributes: string[] = [];

	private shop: ShopContextValue | null = null;
	private handle: EmbeddedCheckout | null = null;
	private unsubscribe: (() => void) | null = null;
	/** Guards the cart-store subscription from starting a second session. */
	private booting = false;
	/**
	 * Set once a session is committed to, success or failure. A failed start is
	 * never retried from a cart notification, since that could create a second
	 * session for a shopper who has already paid. Cleared only on re-attach
	 * (which resumes) and when the page empties the cart.
	 */
	private booted = false;
	/**
	 * The session a torn-down handle was showing. An element that is removed
	 * and re-inserted (list reorder, portal move, StrictMode remount) resumes
	 * it rather than creating a second session.
	 */
	private resumeSessionId: string | null = null;
	private announcedEmpty = false;
	/**
	 * Bumped on teardown, so an in-flight `mount()`/`resume()` can tell its
	 * element was detached and destroy the handle instead of leaking its
	 * window listeners and handshake timer. A token rather than a flag because
	 * the element can be reconnected.
	 */
	private bootToken = 0;
	/**
	 * True while the handle came from `resume()`. A return leg lands after the
	 * order exists, so an empty cart is expected there.
	 */
	private resuming = false;
	/**
	 * Set on `complete`: the frame shows a receipt for a cart the platform has
	 * dropped, so an empty cart must not tear it down.
	 */
	private completed = false;
	/**
	 * The cart store's `revision` as of the last change the frame was told
	 * about (see `CartSnapshot.revision`). Baselined when a boot starts, not
	 * when the handle arrives, so a cart change made during `mount()` is still
	 * picked up by `wire()` on `ready`.
	 */
	private cartRevision = 0;

	protected start(): void {
		this.withShop((shop) => {
			this.shop = shop;
			this.unsubscribe?.();
			// The cart loads asynchronously, so the first boot usually comes from
			// this subscription. It is also how an emptied cart takes the frame down.
			this.unsubscribe = shop.cartStore.subscribe(() => this.onCartChange());
			void shop.cartStore.load();
			void this.boot();
		});

		this.cleanups.push(() => {
			this.bootToken++;
			this.unsubscribe?.();
			this.unsubscribe = null;
			this.retainForResume(this.handle);
			this.handle?.destroy();
			this.handle = null;
		});
	}

	/**
	 * Keep the session of a handle being destroyed and unblock `boot()` to
	 * resume it. Without a session id `booted` stays set: a fresh `mount()`
	 * on reconnect could charge the shopper twice.
	 */
	private retainForResume(handle: EmbeddedCheckout | null): void {
		this.resumeSessionId = handle?.sessionId ?? this.resumeSessionId;
		if (this.resumeSessionId) this.booted = false;
	}

	/** The live embed handle, for a page that wants to drive it by hand. */
	get checkout(): EmbeddedCheckout | null {
		return this.handle;
	}

	/**
	 * An emptied cart takes the frame down, a changed cart is re-read by the
	 * frame, and anything else is a chance to boot. Emptied is checked first
	 * because `clear()` also counts as a mutation.
	 */
	private onCartChange(): void {
		if (this.handle && this.cartWasEmptied()) {
			this.discardForEmptyCart(this.handle);
			return;
		}
		if (this.handle && this.cartWasMutated()) {
			this.handle.cartUpdated();
			return;
		}
		void this.boot();
	}

	/**
	 * True when the page has changed the cart since the frame was last told.
	 * Consumes the change. A plain `load()` or `refresh()` does not count;
	 * acting on one would loop with the frame's own re-read.
	 */
	private cartWasMutated(): boolean {
		const revision = this.shop?.cartStore.getSnapshot().revision ?? 0;
		if (revision === this.cartRevision) return false;
		this.cartRevision = revision;
		return true;
	}

	private async boot(): Promise<void> {
		if (this.booted || this.booting || !this.shop) return;
		const shop = this.shop;

		// Resuming wins over a new session, which could charge the shopper twice.
		// The return-leg parameters stay on the URL until `wire()` sees `ready`,
		// so a resume that fails earlier can be retried by reloading.
		const returned = this.resumeTarget();

		if (!returned && !this.hasSomethingToCheckOut()) return;

		this.booting = true;
		this.booted = true;
		this.setState("loading");
		// Before the await; see `cartRevision`.
		this.cartRevision = shop.cartStore.getSnapshot().revision;
		const token = this.bootToken;
		try {
			const handle = returned
				? await shop.client.checkout.resume(this, returned.sessionId, {
						storeId: returned.storeId,
						language: this.attr("lang"),
						successUrl: absolute(this.attr("success-url")),
						...this.renderOptions(),
					})
				: await shop.client.checkout.mount(this, {
						successUrl: this.successUrl(),
						backUrl: absolute(this.attr("back-url")),
						language: this.attr("lang"),
						theme: checkoutTheme(this.attr("theme")),
						...this.renderOptions(),
					});
			// Detached while in flight: the cleanup saw no handle, so destroy it here.
			if (token !== this.bootToken) {
				this.retainForResume(handle);
				handle.destroy();
				return;
			}
			this.resuming = returned !== null;
			// The cart was emptied while the handoff was in flight.
			if (this.cartWasEmptied()) {
				this.discardForEmptyCart(handle);
				return;
			}
			this.handle = handle;
			this.announcedEmpty = false;
			this.wire(handle);
		} catch (error) {
			this.fail(error, "<qb-checkout> could not start the checkout");
		} finally {
			this.booting = false;
			// Re-attached while in flight: that boot discarded its handle, so
			// start the resume the reconnect could not.
			if (!this.booted && this.isConnected) void this.boot();
		}
	}

	/**
	 * What to resume: the session a re-attached element was showing, else the
	 * return leg on this page's URL, else nothing.
	 */
	private resumeTarget(): ReturnedCheckout | null {
		if (this.resumeSessionId) {
			return { sessionId: this.resumeSessionId, storeId: null };
		}
		return readReturnedCheckout();
	}

	/**
	 * True when there is a cart worth checking out. False while the cart is
	 * still loading (the store will notify again); an empty cart is announced
	 * once.
	 */
	private hasSomethingToCheckOut(): boolean {
		const snapshot = this.shop?.cartStore.getSnapshot();
		if (!snapshot || snapshot.status !== "ready") return false;
		if (snapshot.itemCount > 0) return true;
		this.announceEmpty();
		return false;
	}

	/**
	 * True when the cart store has settled on empty under a frame that expects
	 * a cart (not a return leg or a completed order).
	 */
	private cartWasEmptied(): boolean {
		if (this.resuming || this.completed) return false;
		const snapshot = this.shop?.cartStore.getSnapshot();
		return snapshot?.status === "ready" && snapshot.itemCount === 0;
	}

	/**
	 * Take down a frame whose cart the page has emptied. Nothing is kept for a
	 * resume and `booted` is cleared: no payment can have happened, so the next
	 * non-empty cart boots a fresh session.
	 */
	private discardForEmptyCart(handle: EmbeddedCheckout): void {
		handle.destroy();
		this.handle = null;
		this.resuming = false;
		this.resumeSessionId = null;
		this.booted = false;
		this.announceEmpty();
	}

	/** Say "nothing to check out" once per empty phase, not once per update. */
	private announceEmpty(): void {
		if (this.announcedEmpty) return;
		this.announcedEmpty = true;
		this.setState("idle");
		this.emit("checkout-empty", {});
	}

	/** Re-broadcast the handle's events as DOM events on this element. */
	private wire(handle: EmbeddedCheckout): void {
		handle.on("ready", (detail) => {
			this.setState("ready");
			// The frame does not re-read the cart on load, so pass on any change
			// made while it was being built.
			if (this.cartWasMutated()) handle.cartUpdated();
			// The return leg is over: strip the URL parameters if they name this
			// session. A reloaded frame sends `ready` again; that strip is a no-op.
			if (readReturnedSessionId() === handle.sessionId) {
				stripReturnedSessionId();
			}
			this.emit("checkout-ready", detail);
		});
		handle.on("step", (detail) => this.emit("checkout-step", detail));
		handle.on("event", (detail) => {
			// Funnel events also go to the page's analytics, consent permitting.
			this.shop?.analytics?.track({
				name: detail.name,
				params: detail.params as CommerceEventParams,
			});
			this.emit("checkout-event", detail);
		});
		handle.on("complete", (detail) => {
			this.completed = true;
			this.emit("checkout-complete", detail);
		});
		handle.on("demo-complete", (detail) => {
			this.completed = true;
			this.emit("checkout-demo-complete", detail);
		});
		handle.on("fallback", (detail) => this.emit("checkout-fallback", detail));
		handle.on("error", (detail) => {
			if (detail.fatal) this.setState("error");
			this.emit("checkout-error", detail);
		});
	}

	private renderOptions() {
		return {
			minHeight: this.numberAttr("min-height"),
			confirmation:
				this.attr("confirmation") === "inline"
					? ("inline" as const)
					: ("redirect" as const),
		};
	}

	/**
	 * Where the shopper lands after paying. Defaults to the current page with
	 * a one-time console warning, as `<qb-checkout-button>` does.
	 */
	private successUrl(): string {
		const configured = absolute(this.attr("success-url"));
		if (configured) return configured;
		if (!warnedAboutSuccessUrl) {
			warnedAboutSuccessUrl = true;
			console.warn(
				"shopkit: <qb-checkout> has no success-url, so the shopper stays on " +
					"this page after paying. Point it at your thank-you page — " +
					'success-url="/thanks" — or set confirmation="inline" to keep the ' +
					"confirmation inside the frame on purpose.",
			);
		}
		return window.location.href;
	}
}

let warnedAboutSuccessUrl = false;
