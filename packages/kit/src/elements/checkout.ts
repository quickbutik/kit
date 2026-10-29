import { purchaseFromSession } from "../analytics/events.js";
import type { StartCheckoutInput } from "../sdk/resources/checkout.js";
import type {
	ConfirmationOutcome,
	SessionConfirmation,
} from "../sdk/types/checkout.js";
import { releaseOnRestore } from "../state/navigation-hold.js";
import { QbElement } from "./base.js";
import type { Scope } from "./bindings.js";
import { decorateHandoff } from "./handoff.js";
import { QbScopeElement } from "./scope.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-checkout-button>` — hands the shopper to the hosted Quickbutik checkout.
 *
 * ```html
 * <qb-checkout-button success-url="/order" back-url="/">
 *   <button>Till kassan</button>
 * </qb-checkout-button>
 * ```
 *
 * Adds no markup. A click anywhere inside creates the checkout session and
 * navigates. Relative URLs are resolved against the current origin.
 *
 * `theme="dark"` paints the hosted checkout dark for this shopper. Omit it and
 * the merchant's own choice applies — see {@link checkoutTheme}.
 *
 * Payment (PSP, PCI scope, 3-D Secure, wallets) is handled entirely by the
 * hosted checkout.
 */
export class QbCheckoutButtonElement extends QbElement {
	static observedAttributes = ["success-url", "back-url", "disabled"];

	private shop: ShopContextValue | null = null;
	private unsubscribe: (() => void) | null = null;
	/** Guards a double-click, whose second navigation would race the first. */
	private starting = false;

	protected start(): void {
		this.withShop((shop) => {
			this.shop = shop;
			this.unsubscribe?.();
			this.unsubscribe = shop.cartStore.subscribe(() => this.reflect());
			this.reflect();
			void shop.cartStore.load();
		});

		const onClick = (event: Event): void => {
			if (event.cancelable) event.preventDefault();
			void this.checkout();
		};
		this.addEventListener("click", onClick);
		this.cleanups.push(() => {
			this.removeEventListener("click", onClick);
			this.unsubscribe?.();
			this.unsubscribe = null;
		});
		this.reflect();
	}

	protected update(): void {
		this.reflect();
	}

	/**
	 * Create the session and navigate. With `no-redirect`, only emits
	 * `qb:checkout-started` with the URL, e.g. to open it in a new tab.
	 */
	async checkout(): Promise<void> {
		if (this.starting || this.hasAttribute("disabled") || !this.shop) return;

		const cart = this.shop.cartStore.getSnapshot().cart;
		if (!cart || cart.itemCount === 0) {
			this.emit("checkout-empty", {});
			return;
		}

		this.starting = true;
		this.setState("loading");
		this.toggleAttr("pending", true);
		this.reflect();

		let navigated = false;
		try {
			// Decorated first, so the event carries the URL the shopper lands on.
			const result = decorateHandoff(
				await this.shop.client.checkout.start(
					checkoutStartInput(
						(name) => this.attr(name),
						`<${this.tagName.toLowerCase()}>`,
					),
				),
				this.shop,
			);
			this.emit("checkout-started", result);
			this.setState("ready");
			if (!this.boolAttr("no-redirect")) {
				// `assign`, not `replace`: back should return to the cart.
				window.location.assign(result.url);
				navigated = true;
			}
		} catch (error) {
			this.fail(error, "<qb-checkout-button> could not start the checkout");
		} finally {
			// Held while the navigation commits — see `releaseOnRestore`.
			const release = (): void => {
				this.starting = false;
				this.toggleAttr("pending", false);
				this.reflect();
			};
			if (navigated) releaseOnRestore(release);
			else release();
		}
	}

	private reflect(): void {
		const snapshot = this.shop?.cartStore.getSnapshot();
		const empty = (snapshot?.itemCount ?? 0) === 0;
		const blocked = this.starting || empty;

		this.toggleAttr("empty", empty);
		this.toggleAttr("blocked", blocked);

		const explicitlyDisabled = this.hasAttribute("disabled");
		for (const control of this.querySelectorAll<
			HTMLButtonElement | HTMLInputElement
		>("button, input[type=submit], input[type=button]")) {
			control.disabled = blocked || explicitlyDisabled;
		}
	}
}

/**
 * The redirect-checkout input built from `success-url`, `back-url` and `theme`
 * as returned by `read`, so element attributes (`<qb-checkout-button>`,
 * `<qb-buy-now>`) and `data-qb-*` attributes on a `buy-now` button follow the
 * same rules.
 */
export function checkoutStartInput(
	read: (name: "success-url" | "back-url" | "theme") => string | undefined,
	where: string,
	attribute = "success-url",
): StartCheckoutInput {
	return {
		successUrl: defaultedSuccessUrl(read("success-url"), where, attribute),
		backUrl: absolute(read("back-url")),
		theme: checkoutTheme(read("theme")),
	};
}

/**
 * Where the shopper lands after paying. Defaults to the current page, with a
 * one-time console warning per `where` naming `attribute`.
 *
 * The hosted checkout uses only its origin: the shopper comes back to
 * `<origin>/success/<orderNumber>`.
 */
function defaultedSuccessUrl(
	value: string | undefined,
	where: string,
	attribute = "success-url",
): string {
	const configured = absolute(value);
	if (configured) return configured;
	if (!warnedAboutSuccessUrl.has(where)) {
		warnedAboutSuccessUrl.add(where);
		console.warn(
			`shopkit: ${where} has no ${attribute}, so the shopper comes back to ` +
				"this page after paying. Point it at your thank-you page — " +
				`${attribute}="/order" — and put a <qb-order-confirmation> there.`,
		);
	}
	return window.location.href;
}

const warnedAboutSuccessUrl = new Set<string>();

/**
 * Resolve a relative URL such as `success-url="/order"` against the current
 * page; the platform needs absolute URLs. Returns invalid input unchanged.
 */
export function absolute(url: string | undefined): string | undefined {
	if (url === undefined) return undefined;
	try {
		return new URL(url, window.location.href).toString();
	} catch {
		return url;
	}
}

/**
 * Validate a `theme` attribute: `"light"`, `"dark"` (case-insensitive) or
 * `undefined`.
 *
 * Omitting it is not the same as `"light"`: without it the checkout follows
 * the theme the merchant chose for their shop; with it the checkout is pinned.
 * Set it when your own pages are dark, so the checkout does not flash white.
 * Any other value is dropped with a one-time console warning, because the
 * platform would reject the whole session over it.
 */
export function checkoutTheme(
	value: string | undefined,
): "light" | "dark" | undefined {
	if (value === undefined) return undefined;
	const named = value.trim().toLowerCase();
	if (named === "light" || named === "dark") return named;
	if (!warnedAboutTheme) {
		warnedAboutTheme = true;
		console.warn(
			`shopkit: theme="${value}" is not a checkout theme — the only two are ` +
				'"light" and "dark". Ignoring it, so this checkout follows the theme ' +
				"the merchant chose for their shop.",
		);
	}
	return undefined;
}

let warnedAboutTheme = false;

/**
 * `<qb-order-confirmation>` — the thank-you page.
 *
 * ```html
 * <qb-order-confirmation>
 *   <p data-qb-show="confirmation.loading">Skapar din order…</p>
 *   <p data-qb-show="confirmation.completed">
 *     Tack! Ordernummer <strong data-qb-text="confirmation.orderNumber"></strong>
 *   </p>
 *   <p data-qb-show="confirmation.failed">Betalningen gick inte igenom.</p>
 * </qb-order-confirmation>
 * ```
 *
 * Order creation is asynchronous after payment, so a shopper can land here
 * before the order exists. This polls until `completed`, `failed` or `timeout`,
 * reflecting each as both a scope flag and a `status` attribute.
 *
 * The session id comes from `session-id`, a `?session_id=` query parameter,
 * or the session remembered when the checkout was started.
 *
 * With analytics on, a completed order is reported once as a `purchase` event
 * built from the session's lines and total (the hosted checkout does not fire
 * it in redirect mode). `no-track-purchase` turns that off; in `inline`
 * success mode the embedded frame reports it instead.
 */
export class QbOrderConfirmationElement extends QbScopeElement {
	static observedAttributes = ["session-id"];

	private shop: ShopContextValue | null = null;
	private confirmation: SessionConfirmation | null = null;
	private outcome: ConfirmationOutcome | null = null;
	private loading = true;
	private error: Error | null = null;
	private controller: AbortController | null = null;
	/** The order already reported, so a re-poll does not repeat it. */
	private trackedOrder: string | null = null;

	protected start(): void {
		this.initScope();
		this.withShop((shop) => {
			this.shop = shop;
			void this.poll();
		});
		this.cleanups.push(() => this.controller?.abort());
	}

	protected update(): void {
		void this.poll();
	}

	protected stop(): void {
		this.controller?.abort();
		this.controller = null;
	}

	private async poll(): Promise<void> {
		if (!this.shop) return;
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;

		this.loading = true;
		this.error = null;
		this.setState("loading");
		this.render();

		try {
			const sessionId =
				this.attr("session-id") ??
				new URLSearchParams(window.location.search).get("session_id") ??
				(await this.shop.client.checkout.currentSessionId());

			if (controller.signal.aborted) return;
			if (!sessionId) {
				throw new Error(
					"shopkit: <qb-order-confirmation> has no checkout session to " +
						'confirm. Give it a session-id="…", put ?session_id=… on the ' +
						"return URL, or make sure the checkout was started through shopkit.",
				);
			}

			// Read before polling: a completed confirmation forgets the stored ids.
			const storeId = this.shop.client.checkout.rememberedStoreId();
			const outcome = await this.shop.client.checkout.pollConfirmation(
				sessionId,
				{
					signal: controller.signal,
					onUpdate: (snapshot) => {
						if (controller.signal.aborted) return;
						this.confirmation = snapshot;
						this.render();
					},
				},
			);
			if (controller.signal.aborted) return;

			this.outcome = outcome;
			this.loading = false;
			this.setState("ready");
			this.emit("confirmation", outcome);
			this.render();
			void this.trackPurchase(sessionId, storeId, outcome);
		} catch (error) {
			if (controller.signal.aborted) return;
			this.loading = false;
			this.error = error instanceof Error ? error : new Error(String(error));
			this.fail(this.error, "<qb-order-confirmation> could not confirm");
			this.render();
		}
	}

	/**
	 * Report the order to the shop's analytics, once. Never throws or changes
	 * the element's state. When the session has no lines or total, warns and
	 * points at `analytics.trackPurchase()`.
	 */
	private async trackPurchase(
		sessionId: string,
		storeId: string | null,
		outcome: ConfirmationOutcome,
	): Promise<void> {
		if (outcome.kind !== "completed") return;
		if (this.boolAttr("no-track-purchase")) return;
		const shop = this.shop;
		const analytics = shop?.analytics;
		if (!shop || !analytics) return;
		// The embedded frame fires `purchase` itself in inline mode.
		if (outcome.confirmation.successMode === "inline") return;
		const orderNumber =
			outcome.orderNumber ?? outcome.confirmation.orderNumber ?? null;
		if (orderNumber === null) return;
		const key = `${sessionId}:${orderNumber}`;
		if (this.trackedOrder === key) return;
		this.trackedOrder = key;

		try {
			const snapshot = await shop.client.checkout.getSession(sessionId);
			const purchase = purchaseFromSession(snapshot, orderNumber);
			if (!purchase) {
				console.warn(
					"shopkit: <qb-order-confirmation> could not build a purchase event " +
						`for order ${orderNumber}: the checkout session carries no lines ` +
						"or total. Call analytics.trackPurchase() with your own data.",
				);
				return;
			}
			analytics.trackPurchase(purchase, {
				storeId: storeId ?? shop.client.shopPrefix,
				orderNumber,
			});
		} catch (error) {
			console.warn(
				"shopkit: <qb-order-confirmation> could not track the purchase",
				error,
			);
		}
	}

	protected ownScope(): Scope {
		const status = this.confirmation?.status ?? null;
		const kind = this.outcome?.kind ?? null;
		const orderNumber =
			(this.outcome?.kind === "completed" ? this.outcome.orderNumber : null) ??
			this.confirmation?.orderNumber ??
			null;

		return {
			...this.parentScope,
			confirmation: {
				status,
				kind,
				orderNumber,
				loading: this.loading,
				completed: kind === "completed",
				failed: kind === "failed",
				timedOut: kind === "timeout",
				processing: status === "processing_payment",
				error: this.error?.message ?? null,
				raw: this.confirmation,
			},
		};
	}

	protected render(): void {
		const kind = this.outcome?.kind ?? (this.loading ? "pending" : "unknown");
		this.setAttribute("status", kind);
		super.render();
	}
}
