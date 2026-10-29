import { formatMoney, formatMoneyRange } from "../format/money.js";
import type { Cart, CartItem } from "../sdk/types/cart.js";
import type { ProductVariant } from "../sdk/types/catalog.js";
import type { MinorUnits } from "../sdk/types/common.js";
import type { ProductSnapshot } from "../state/product-controller.js";
import type {
	VariantOptionGroupState,
	VariantOptionValueState,
} from "../state/variant-matrix.js";
import type { Scope } from "./bindings.js";

/**
 * Turning state into the plain objects `data-qb-text="…"` reads. HTML bindings
 * cannot format money themselves, so every money field appears twice: the raw
 * minor-unit integer, and a display string.
 */

export interface MoneyView {
	/** Minor units, exactly as the API states them. */
	amount: MinorUnits | null;
	/** Localised display string, e.g. `1 299,00 kr`. */
	formatted: string;
	currency: string | null;
}

let warnedAboutCurrency = false;

/**
 * Format one amount, tolerating an unknown currency: without one, the number
 * is formatted with two decimals and no symbol, and a console warning is
 * logged once.
 */
export function money(
	amount: MinorUnits | null | undefined,
	currency: string | undefined | null,
	locale: string | undefined,
): MoneyView {
	if (amount === null || amount === undefined) {
		return { amount: null, formatted: "", currency: currency ?? null };
	}
	if (!currency) {
		warnMissingCurrency();
		return {
			amount,
			formatted: new Intl.NumberFormat(locale, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(amount / 100),
			currency: null,
		};
	}
	return {
		amount,
		formatted: formatMoney(amount, currency, { locale }),
		currency,
	};
}

function warnMissingCurrency(): void {
	if (warnedAboutCurrency) return;
	warnedAboutCurrency = true;
	console.warn(
		"shopkit: no currency is configured, so prices are rendered as plain " +
			'numbers with two decimals. Set data-currency="SEK" on the script tag, ' +
			'or configure({ currency: "SEK" }).',
	);
}

/** For tests, which must be able to observe the warning more than once. */
export function resetCurrencyWarning(): void {
	warnedAboutCurrency = false;
}

// Product

export interface PriceView extends MoneyView {
	/** The struck-through "before" price, when the variant is on sale. */
	compareAt: MoneyView;
	/** True when the variant is cheaper than its compare-at price. */
	onSale: boolean;
	min: MoneyView;
	max: MoneyView;
	/** True when the reachable variants do not all cost the same. */
	isRange: boolean;
	/**
	 * What a price label should actually say: the exact figure once a variant is
	 * pinned, the range (`99,00 kr – 149,00 kr`) before that, and the single
	 * figure when every reachable variant costs the same.
	 */
	display: string;
}

export function priceView(
	snapshot: ProductSnapshot,
	currency: string | undefined,
	locale: string | undefined,
): PriceView {
	const { price } = snapshot;
	const exact = money(price.amount, currency, locale);
	const compareAt = money(price.compareAtAmount, currency, locale);
	const range =
		currency !== undefined
			? formatMoneyRange(price.min, price.max, currency, { locale })
			: money(price.min, currency, locale).formatted;

	return {
		...exact,
		compareAt,
		onSale:
			price.amount !== null &&
			price.compareAtAmount !== null &&
			price.compareAtAmount > price.amount,
		min: money(price.min, currency, locale),
		max: money(price.max, currency, locale),
		isRange: price.isRange,
		display: exact.formatted || range || "",
	};
}

export interface VariantView {
	id: number | null;
	sku: string | null;
	/** Stock level, or null for a shop that does not track inventory. */
	stock: number | null;
	/** True only when stock is tracked AND exhausted — never for untracked. */
	soldOut: boolean;
	preorder: boolean;
	/** True once the selection pins exactly one variant. */
	selected: boolean;
}

export function variantView(variant: ProductVariant | null): VariantView {
	if (!variant) {
		return {
			id: null,
			sku: null,
			stock: null,
			soldOut: false,
			preorder: false,
			selected: false,
		};
	}
	return {
		id: variant.id,
		sku: variant.sku,
		stock: variant.stock.stock,
		soldOut: variant.stock.stock !== null && variant.stock.stock <= 0,
		preorder: variant.stock.preorder === true,
		selected: true,
	};
}

/** The scope `<qb-product>` contributes. */
export function productScope(
	snapshot: ProductSnapshot,
	currency: string | undefined,
	locale: string | undefined,
): Scope {
	// The product's own currency wins: it is what its amounts are in.
	const effective = snapshot.product.currency ?? currency;
	return {
		product: {
			...snapshot.product,
			/** The main image, ready to render — `images[0]` with the URL resolved. */
			image: snapshot.product.images[0] ?? null,
		},
		price: priceView(snapshot, effective, locale),
		variant: variantView(snapshot.selectedVariant),
		options: snapshot.options,
		hasOptions: snapshot.hasOptions,
		isComplete: snapshot.isComplete,
	};
}

export function optionGroupScope(group: VariantOptionGroupState): Scope {
	return {
		group: {
			id: group.id,
			name: group.name,
			position: group.position,
			selectedValueId: group.selectedValueId,
			values: group.values,
			/** True once this group has a choice — for a "Choose a size" prompt. */
			chosen: group.selectedValueId !== null,
		},
	};
}

export function optionValueScope(value: VariantOptionValueState): Scope {
	return {
		value: {
			id: value.id,
			name: value.name,
			optionId: value.optionId,
			position: value.position,
			selected: value.selected,
			available: value.available,
			/** The inverse, so a template can bind it without a negation syntax. */
			unavailable: !value.available,
			variantIds: value.variantIds,
		},
	};
}

// Cart

export function cartItemScope(
	item: CartItem,
	currency: string | undefined,
	locale: string | undefined,
): Scope {
	return {
		item: {
			...item,
			unitPriceFormatted: money(item.unitPrice, currency, locale).formatted,
			lineTotalFormatted: money(item.lineTotal, currency, locale).formatted,
			compareAtFormatted: money(item.compareAtPrice, currency, locale)
				.formatted,
			discountFormatted: money(item.discountAmount, currency, locale).formatted,
			onSale:
				item.compareAtPrice !== null && item.compareAtPrice > item.unitPrice,
		},
	};
}

/** The scope `<qb-cart>` contributes. */
export function cartScope(
	cart: Cart | null,
	itemCount: number,
	locale: string | undefined,
	fallbackCurrency: string | undefined,
): Scope {
	// The cart's own currency wins: it is what its amounts are in (in display
	// mode the charged currency is `cart.presentment.chargeCurrency`).
	const currency = cart?.currency ?? fallbackCurrency;
	return {
		cart: {
			...(cart ?? {}),
			id: cart?.id ?? null,
			items: cart?.items ?? [],
			itemCount,
			empty: itemCount === 0,
			currency: currency ?? null,
			subtotalFormatted: money(cart?.subtotal, currency, locale).formatted,
			totalFormatted: money(cart?.total, currency, locale).formatted,
			totalTaxFormatted: money(cart?.totalTax, currency, locale).formatted,
			totalDiscountFormatted: money(cart?.totalDiscount, currency, locale)
				.formatted,
		},
	};
}
