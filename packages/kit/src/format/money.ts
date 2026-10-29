import type { CurrencyCode, MinorUnits } from "../sdk/types/common.js";
import { currencyDecimals } from "../seo/money.js";

export interface FormatMoneyOptions {
	/**
	 * BCP 47 locale — `"sv-SE"` gives `1 299,00 kr`, `"en-US"` gives
	 * `SEK 1,299.00`. Defaults to the runtime's locale; pass one explicitly
	 * on a server.
	 */
	locale?: string;
	/**
	 * False renders the bare number with no currency symbol (`1 299,00`).
	 * Default true.
	 */
	symbol?: boolean;
}

/**
 * Minor units → a display string in the shopper's locale. The number of
 * decimals follows the currency ({@link currencyDecimals}), so JPY and ISK
 * get none.
 *
 * ```ts
 * formatMoney(129900, "SEK", { locale: "sv-SE" })  // "1 299,00 kr"
 * formatMoney(990, "JPY", { locale: "ja-JP" })     // "￥990"  — no decimals
 * formatMoney(129900, "SEK", { symbol: false })    // "1 299,00"
 * ```
 */
export function formatMoney(
	amount: MinorUnits,
	currency: CurrencyCode,
	options: FormatMoneyOptions = {},
): string {
	const digits = currencyDecimals(currency);
	const major = amount / 10 ** digits;
	const { locale, symbol = true } = options;

	try {
		return new Intl.NumberFormat(locale, {
			...(symbol
				? { style: "currency" as const, currency }
				: { style: "decimal" as const }),
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}).format(major);
	} catch {
		// An unknown currency code throws; fall back to the number plus the code.
		const number = major.toFixed(digits);
		return symbol ? `${number} ${currency}` : number;
	}
}

/**
 * A price range (`99 kr – 149 kr`), or a single figure when both ends agree.
 * Null when both are null.
 */
export function formatMoneyRange(
	min: MinorUnits | null,
	max: MinorUnits | null,
	currency: CurrencyCode,
	options: FormatMoneyOptions = {},
): string | null {
	if (min === null && max === null) return null;
	const low = min ?? (max as MinorUnits);
	const high = max ?? (min as MinorUnits);
	if (low === high) return formatMoney(low, currency, options);
	return `${formatMoney(low, currency, options)} – ${formatMoney(high, currency, options)}`;
}
