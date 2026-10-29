import { releaseOnRestore } from "../state/navigation-hold.js";
import { claimAction } from "./actions.js";
import { QbElement } from "./base.js";
import { checkoutStartInput } from "./checkout.js";
import { decorateHandoff } from "./handoff.js";
import {
	type ProductContextValue,
	productContext,
	quantityFrom,
} from "./product.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-buy-now>` — "Köp nu": add the selected variant and go straight to the
 * hosted checkout.
 *
 * ```html
 * <qb-product slug="cotton-tee">
 *   <qb-options>…</qb-options>
 *   <qb-add-to-cart><button>Lägg i varukorgen</button></qb-add-to-cart>
 *   <qb-buy-now success-url="/order" back-url="/">
 *     <button>Köp nu</button>
 *   </qb-buy-now>
 * </qb-product>
 * ```
 *
 * Behaves like `<qb-add-to-cart>` followed by `<qb-checkout-button>`: it must
 * sit inside a `<qb-product>`, is blocked until exactly one variant is pinned,
 * takes quantity from `quantity="2"`, `data-qb-quantity` on the clicked
 * element or a nearby `input[data-qb-quantity-input]`, and accepts
 * `success-url`, `back-url`, `theme` and `no-redirect`. `qb:checkout-started`
 * carries the handoff.
 *
 * The item is added to the remembered cart, so anything already in the basket
 * is checked out with it.
 *
 * Adds no markup. `data-qb-action="buy-now"` on a plain button inside
 * `<qb-product>` does the same thing without the disabled-state management.
 */
export class QbBuyNowElement extends QbElement {
	static observedAttributes = [
		"success-url",
		"back-url",
		"theme",
		"quantity",
		"disabled",
	];

	private product: ProductContextValue | null = null;
	private shop: ShopContextValue | null = null;
	private unsubscribeController: (() => void) | null = null;
	private unsubscribeCart: (() => void) | null = null;
	/** Guards a double-click, which would add the item twice. */
	private busy = false;

	protected start(): void {
		const answered = this.consume(productContext, (product) => {
			const changed = this.product?.controller !== product.controller;
			this.product = product;
			// Only when the controller changed: this runs inside its notification loop.
			if (changed) {
				this.unsubscribeController?.();
				this.unsubscribeController =
					product.controller?.subscribe(() => this.reflect()) ?? null;
			}
			this.reflect();
		});
		if (!answered) {
			console.warn(
				"shopkit: <qb-buy-now> is not inside a <qb-product>, so it does not " +
					"know what to buy.",
			);
		}

		this.withShop((shop) => {
			this.shop = shop;
			this.unsubscribeCart?.();
			this.unsubscribeCart = shop.cartStore.subscribe(() => this.reflect());
			this.reflect();
		});

		const onClick = (event: Event): void => {
			// A `data-qb-action` button is handled by <qb-product>; acting here too
			// would buy the item twice.
			const origin = event.target;
			if (
				origin instanceof Element &&
				this.querySelector("[data-qb-action]") &&
				origin.closest("[data-qb-action]")
			) {
				return;
			}
			if (event.cancelable) event.preventDefault();
			// Claimed, so an ancestor's `data-qb-action` does not also act.
			claimAction(event);
			void this.buy(
				origin instanceof HTMLElement ? quantityFrom(origin, this) : undefined,
			);
		};
		this.addEventListener("click", onClick);

		this.cleanups.push(() => {
			this.removeEventListener("click", onClick);
			this.unsubscribeController?.();
			this.unsubscribeCart?.();
			this.unsubscribeController = null;
			this.unsubscribeCart = null;
		});

		this.reflect();
	}

	protected update(): void {
		this.reflect();
	}

	/**
	 * Add the current selection, start the checkout and navigate.
	 *
	 * A no-op while the selection is incomplete (`<qb-product>` emits
	 * `qb:add-to-cart-blocked`), while one is already in flight, or while the
	 * element carries `disabled`. After navigating it stays busy until the page
	 * is restored from the back/forward cache. `no-redirect` only emits
	 * `qb:checkout-started`.
	 */
	async buy(quantity?: number): Promise<void> {
		if (!this.product || this.busy || this.hasAttribute("disabled")) return;
		this.busy = true;
		this.setState("loading");
		this.reflect();
		let navigated = false;
		try {
			const amount = quantity ?? this.numberAttr("quantity") ?? 1;
			// Lazy, so a blocked click does not also warn about a missing success-url.
			const started = await this.product.buyNow(
				() =>
					checkoutStartInput(
						(name) => this.attr(name),
						`<${this.tagName.toLowerCase()}>`,
					),
				amount,
			);
			this.setState("ready");
			if (!started) return;
			const result = decorateHandoff(started, this.shop);
			this.emit("checkout-started", result);
			if (!this.boolAttr("no-redirect")) {
				// `assign`, not `replace`: back should return to the product.
				window.location.assign(result.url);
				navigated = true;
			}
		} catch (error) {
			this.fail(error, "<qb-buy-now> could not start the checkout");
		} finally {
			// Stay busy while the navigation commits. See `releaseOnRestore`.
			const release = (): void => {
				this.busy = false;
				this.reflect();
			};
			if (navigated) releaseOnRestore(release);
			else release();
		}
	}

	/** Keep inner controls' `disabled` in step; see `<qb-add-to-cart>`. */
	private reflect(): void {
		const pending = this.shop?.cartStore.getSnapshot().pending ?? 0;
		const canBuy = this.product?.canAddToCart() ?? false;
		const blocked = this.busy || pending > 0 || !canBuy;

		this.toggleAttr("pending", this.busy || pending > 0);
		this.toggleAttr("blocked", blocked);

		const explicitlyDisabled = this.hasAttribute("disabled");
		for (const control of this.querySelectorAll<
			HTMLButtonElement | HTMLInputElement
		>("button, input[type=submit], input[type=button]")) {
			control.disabled = blocked || explicitlyDisabled;
		}
	}
}
