import { reportUnclaimedActions } from "./actions.js";
import { QbAddToCartElement } from "./add-to-cart.js";
import { markScopeOwner } from "./bindings.js";
import { QbBuyNowElement } from "./buy-now.js";
import {
	QbCartCountElement,
	QbCartElement,
	QbCartItemsElement,
} from "./cart.js";
import {
	QbCheckoutButtonElement,
	QbOrderConfirmationElement,
} from "./checkout.js";
import { QbCheckoutElement } from "./checkout-embed.js";
import {
	QbConsentBannerElement,
	QbConsentGateElement,
	QbConsentSettingsElement,
} from "./consent.js";
import { setConsentBannerTag } from "./consent-context.js";
import { QbCurrencySelectElement } from "./currency-select.js";
import { QbOptionsElement, QbOptionValuesElement } from "./options.js";
import { QbProductElement } from "./product.js";
import { QbProductImageElement } from "./product-image.js";
import { QbProductListElement } from "./product-list.js";
import { QbSeoElement } from "./seo.js";
import { QbShopElement } from "./shop.js";

/**
 * Every element, by its name **without** the prefix. `ownsScope` marks the
 * ones the binding walk must not descend into: they bind their own subtree.
 */
const ELEMENTS = [
	{ name: "shop", ctor: QbShopElement, ownsScope: false },
	{ name: "product", ctor: QbProductElement, ownsScope: true },
	{ name: "product-list", ctor: QbProductListElement, ownsScope: true },
	{ name: "product-image", ctor: QbProductImageElement, ownsScope: false },
	{ name: "options", ctor: QbOptionsElement, ownsScope: true },
	{ name: "option-values", ctor: QbOptionValuesElement, ownsScope: true },
	{ name: "add-to-cart", ctor: QbAddToCartElement, ownsScope: false },
	{ name: "buy-now", ctor: QbBuyNowElement, ownsScope: false },
	{ name: "cart", ctor: QbCartElement, ownsScope: true },
	{ name: "cart-items", ctor: QbCartItemsElement, ownsScope: true },
	{ name: "cart-count", ctor: QbCartCountElement, ownsScope: false },
	{ name: "checkout-button", ctor: QbCheckoutButtonElement, ownsScope: false },
	{ name: "checkout", ctor: QbCheckoutElement, ownsScope: false },
	{
		name: "order-confirmation",
		ctor: QbOrderConfirmationElement,
		ownsScope: true,
	},
	{ name: "seo", ctor: QbSeoElement, ownsScope: false },
	// Consent is page-level: these work without any shop configured.
	{ name: "consent-banner", ctor: QbConsentBannerElement, ownsScope: true },
	{
		name: "consent-settings",
		ctor: QbConsentSettingsElement,
		ownsScope: false,
	},
	{ name: "consent-gate", ctor: QbConsentGateElement, ownsScope: false },
	{
		name: "currency-select",
		ctor: QbCurrencySelectElement,
		ownsScope: true,
	},
] as const satisfies ReadonlyArray<{
	name: string;
	ctor: CustomElementConstructor;
	ownsScope: boolean;
}>;

export interface DefineElementsOptions {
	/**
	 * Tag-name prefix. Defaults to `"qb-"`, giving `<qb-product>`. Change it
	 * only for a collision, such as two versions of this package on one page.
	 */
	prefix?: string;
	/**
	 * Warn in the console about a `data-qb-action` nothing handled, such as a
	 * mistyped verb. Default true.
	 */
	warnOnUnhandledActions?: boolean;
}

/** What `defineElements` registered, so a caller can see the real tag names. */
export interface DefinedElements {
	prefix: string;
	/** Bare name → the tag actually registered (`product` → `qb-product`). */
	tags: Record<string, string>;
}

/**
 * Register the custom elements. Explicit rather than an import side effect, so
 * the module stays tree-shakeable; the script-tag build calls it for you. See
 * `configure()` for setup.
 *
 * Idempotent: names already registered are left alone, so calling it twice
 * (or after the script tag did) is harmless.
 */
export function defineElements(
	options: DefineElementsOptions = {},
): DefinedElements {
	const prefix = options.prefix ?? "qb-";
	const tags: Record<string, string> = {};

	if (typeof customElements === "undefined") {
		// A server render: nothing to register.
		return { prefix, tags };
	}

	for (const { name, ctor, ownsScope } of ELEMENTS) {
		const tag = `${prefix}${name}`;
		tags[name] = tag;
		if (ownsScope) markScopeOwner(tag);
		if (name === "consent-banner") setConsentBannerTag(tag);
		if (customElements.get(tag)) continue;
		customElements.define(tag, ctor);
	}

	// Only one document-level listener, however often this is called.
	if (
		options.warnOnUnhandledActions !== false &&
		typeof document !== "undefined" &&
		!unclaimedReporter
	) {
		unclaimedReporter = reportUnclaimedActions(document);
	}

	return { prefix, tags };
}

let unclaimedReporter: (() => void) | null = null;

/** Stop warning about unhandled actions. For tests, and for a hard teardown. */
export function stopActionWarnings(): void {
	unclaimedReporter?.();
	unclaimedReporter = null;
}

/** The element classes, for registering a subset by hand. */
export const elementConstructors = Object.fromEntries(
	ELEMENTS.map(({ name, ctor }) => [name, ctor]),
) as Record<string, CustomElementConstructor>;
