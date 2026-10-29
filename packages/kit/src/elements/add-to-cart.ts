import { claimAction } from "./actions.js";
import { QbElement } from "./base.js";
import {
	type ProductContextValue,
	productContext,
	quantityFrom,
} from "./product.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-add-to-cart>` — wraps the author's own button and makes it work.
 *
 * ```html
 * <qb-add-to-cart>
 *   <button>Lägg i varukorg</button>
 * </qb-add-to-cart>
 * ```
 *
 * Adds no markup: the `<button>` is the page's own. Adding is blocked until
 * exactly one variant is pinned, and the selected variant is what is added.
 *
 * Any click inside it adds, so a whole card can be the target. It keeps the
 * inner controls' `disabled` in step with whether adding is possible right now,
 * and reflects `blocked` / `pending` on itself for styling. Quantity comes from
 * `quantity="2"`, `data-qb-quantity` on the clicked element, or a nearby
 * `input[data-qb-quantity-input]`.
 *
 * `data-qb-action="add-to-cart"` on a plain button inside `<qb-product>` does
 * the same thing without the disabled-state management.
 */
export class QbAddToCartElement extends QbElement {
	static observedAttributes = ["quantity", "disabled"];

	private product: ProductContextValue | null = null;
	private shop: ShopContextValue | null = null;
	private unsubscribeController: (() => void) | null = null;
	private unsubscribeCart: (() => void) | null = null;
	private busy = false;

	protected start(): void {
		const answered = this.consume(productContext, (product) => {
			const changed = this.product?.controller !== product.controller;
			this.product = product;
			// Only when the controller changed: this runs inside its notification
			// loop, where re-adding a listener would run it again in the same pass.
			if (changed) {
				this.unsubscribeController?.();
				this.unsubscribeController =
					product.controller?.subscribe(() => this.reflect()) ?? null;
			}
			this.reflect();
		});
		if (!answered) {
			console.warn(
				"shopkit: <qb-add-to-cart> is not inside a <qb-product>, so it does " +
					"not know what to add.",
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
			// would add the item twice.
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
			void this.add(
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
	 * Add the current selection. A no-op while the selection is incomplete, an
	 * add is already in flight, or the element carries `disabled`.
	 */
	async add(quantity?: number): Promise<void> {
		if (!this.product || this.busy || this.hasAttribute("disabled")) return;
		this.busy = true;
		this.reflect();
		try {
			const amount = quantity ?? this.numberAttr("quantity") ?? 1;
			const cart = await this.product.addToCart(amount);
			if (cart) this.emit("added", { cart, quantity: amount });
		} catch (error) {
			this.fail(error, "<qb-add-to-cart> could not add the item");
		} finally {
			this.busy = false;
			this.reflect();
		}
	}

	/**
	 * Keep inner controls' `disabled` in step: a button that only looks
	 * disabled is still keyboard-clickable, and a double-click during an add
	 * would create a second line.
	 */
	private reflect(): void {
		const pending = this.shop?.cartStore.getSnapshot().pending ?? 0;
		const canAdd = this.product?.canAddToCart() ?? false;
		const blocked = this.busy || pending > 0 || !canAdd;

		this.toggleAttr("pending", this.busy || pending > 0);
		this.toggleAttr("blocked", blocked);
		this.setState(this.busy || pending > 0 ? "loading" : "ready");

		const explicitlyDisabled = this.hasAttribute("disabled");
		for (const control of this.querySelectorAll<
			HTMLButtonElement | HTMLInputElement
		>("button, input[type=submit], input[type=button]")) {
			control.disabled = blocked || explicitlyDisabled;
		}
	}
}
