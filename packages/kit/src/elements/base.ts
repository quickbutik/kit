import { ShopkitConfigError } from "../sdk/errors.js";
import type { Context, ContextCallback } from "./context.js";
import { requestContext } from "./context.js";
import {
	getAmbientShop,
	requireAmbientShop,
	type ShopContextValue,
	shopContext,
} from "./shop-context.js";

/**
 * Base for every element in this package: defers `start()` until children are
 * parsed, unwinds subscriptions on disconnect, and finds the shop.
 *
 * No shadow DOM: these are headless components, styled by the page's own
 * stylesheet.
 */
export abstract class QbElement extends HTMLElement {
	/** Torn down on disconnect. Anything that subscribes must register here. */
	protected cleanups: Array<() => void> = [];
	private started = false;
	private pendingReady: (() => void) | null = null;

	/**
	 * Called once the element's own children are in the DOM. Not
	 * `connectedCallback`: while HTML is parsed, an element is connected at its
	 * start tag, before its children exist.
	 */
	protected abstract start(): void;

	/**
	 * Whether `start()` has run. A property assigned before then (such as
	 * `el.product` right after insertion) must not render yet; `start()` picks
	 * it up.
	 */
	protected get isStarted(): boolean {
		return this.started;
	}

	/** Called on disconnect, after the registered cleanups have run. */
	protected stop(): void {}

	/**
	 * Re-read attributes / re-render when an observed attribute changes.
	 * Override `attributeChangedCallback` instead when the attribute name matters.
	 */
	protected update(): void {}

	connectedCallback(): void {
		this.whenReady(() => {
			if (this.started || !this.isConnected) return;
			this.started = true;
			try {
				this.start();
			} catch (error) {
				// Deferred, so a throw would otherwise be detached from the element.
				this.fail(error, `<${this.tagName.toLowerCase()}> failed to start`);
			}
		});
	}

	disconnectedCallback(): void {
		this.pendingReady = null;
		this.pendingReadyListener?.();
		this.pendingReadyListener = null;
		if (!this.started) return;
		this.started = false;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.stop();
	}

	attributeChangedCallback(_name?: string): void {
		if (this.started) this.update();
	}

	/**
	 * Run `callback` once this element's children are parsed: at
	 * `DOMContentLoaded` while the document is loading, otherwise after a
	 * microtask.
	 */
	protected whenReady(callback: () => void): void {
		const run = (): void => {
			if (this.pendingReady === run) callback();
		};
		this.pendingReady = run;

		if (document.readyState !== "loading") {
			queueMicrotask(run);
			return;
		}
		document.addEventListener("DOMContentLoaded", run, { once: true });
		// Also removed on disconnect, so a detached element is not held alive.
		this.pendingReadyListener = () =>
			document.removeEventListener("DOMContentLoaded", run);
	}

	private pendingReadyListener: (() => void) | null = null;

	// Attributes

	protected attr(name: string): string | undefined {
		const value = this.getAttribute(name);
		return value === null || value === "" ? undefined : value;
	}

	protected numberAttr(name: string): number | undefined {
		const raw = this.attr(name);
		if (raw === undefined) return undefined;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	protected boolAttr(name: string): boolean {
		return this.hasAttribute(name);
	}

	/**
	 * Reflect a state word so the page can style on it:
	 * `qb-product[state="loading"] { opacity: .5 }`.
	 */
	protected setState(state: "idle" | "loading" | "ready" | "error"): void {
		if (this.getAttribute("state") !== state) this.setAttribute("state", state);
	}

	protected toggleAttr(name: string, on: boolean): void {
		if (on === this.hasAttribute(name)) return;
		if (on) this.setAttribute(name, "");
		else this.removeAttribute(name);
	}

	// Context

	/**
	 * Subscribe to a context, unsubscribing automatically on disconnect.
	 * Returns whether a provider answered. Providers hand out a fresh
	 * unsubscribe on every delivery; only the latest is kept.
	 */
	protected consume<T>(
		context: Context<T>,
		callback: ContextCallback<T>,
	): boolean {
		let latest: (() => void) | undefined;
		let registered = false;

		return requestContext(
			this,
			context,
			(value, unsubscribe) => {
				if (unsubscribe) {
					latest = unsubscribe;
					if (!registered) {
						registered = true;
						this.cleanups.push(() => latest?.());
					}
				}
				callback(value);
			},
			true,
		);
	}

	/**
	 * The shop this element belongs to: a `<qb-shop>` ancestor, else the
	 * ambient shop. Throws when neither exists.
	 *
	 * `onChange` fires again if a `<qb-shop>` above swaps its client and, with
	 * `refetchOnCurrencyChange`, when the client's currency or customer changes.
	 * Not named `use…`, since it is not a React hook.
	 */
	protected withShop(
		onChange: (shop: ShopContextValue) => void,
		options: { refetchOnCurrencyChange?: boolean } = {},
	): void {
		let deliver = onChange;
		if (options.refetchOnCurrencyChange) {
			// Prices are server-side per currency, and the ambient shop has no
			// provider to re-deliver on a change.
			let stop: (() => void) | null = null;
			this.cleanups.push(() => {
				stop?.();
				stop = null;
			});
			deliver = (shop) => {
				stop?.();
				const customers = shop.client.customers;
				let who = customers.cacheKey;
				const stopCurrency = shop.client.onCurrencyChange(() => onChange(shop));
				// A login or logout re-prices too (customer-group prices).
				const stopCustomer = customers.onChange(() => {
					if (customers.cacheKey === who) return;
					who = customers.cacheKey;
					onChange(shop);
				});
				stop = () => {
					stopCurrency();
					stopCustomer();
				};
				onChange(shop);
			};
		}
		const answered = this.consume(shopContext, deliver);
		if (answered) return;
		deliver(requireAmbientShop(this.tagName.toLowerCase()));
	}

	/** The shop, synchronously, for a one-shot read. Throws when unconfigured. */
	protected shopNow(): ShopContextValue {
		let found: ShopContextValue | null = null;
		requestContext(this, shopContext, (value) => {
			found = value;
		});
		return found ?? requireAmbientShop(this.tagName.toLowerCase());
	}

	/** Emit a `qb:`-prefixed event. Bubbles and composes, like a native one. */
	protected emit<T>(type: string, detail: T): void {
		this.dispatchEvent(
			new CustomEvent(`qb:${type}`, {
				detail,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * Report a failure: `state="error"`, a `qb:error` event and a console
	 * message. Never throws, so one failing element cannot break the page.
	 */
	protected fail(error: unknown, context: string): void {
		const wrapped = error instanceof Error ? error : new Error(String(error));
		this.setState("error");
		this.emit("error", { error: wrapped, context });
		if (!(wrapped instanceof ShopkitConfigError)) {
			console.error(`shopkit: ${context}`, wrapped);
		} else {
			console.error(wrapped.message);
		}
	}
}

/** True when a shop is configured at all — for a soft check before throwing. */
export function hasShop(): boolean {
	return getAmbientShop() !== null;
}
