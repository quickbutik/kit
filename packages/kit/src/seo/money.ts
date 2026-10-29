import type { CurrencyCode, MinorUnits } from "../sdk/types/common.js";

const digitsCache = new Map<string, number>();

/**
 * How many decimal places a currency's minor unit has: 2 for SEK/EUR, 0 for
 * JPY/ISK. Falls back to 2 when `Intl` does not know the currency.
 */
export function currencyDecimals(currency: CurrencyCode): number {
	const key = currency.toUpperCase();
	const cached = digitsCache.get(key);
	if (cached !== undefined) return cached;

	let digits = 2;
	try {
		const resolved = new Intl.NumberFormat("en", {
			style: "currency",
			currency: key,
		}).resolvedOptions();
		if (typeof resolved.maximumFractionDigits === "number") {
			digits = resolved.maximumFractionDigits;
		}
	} catch {
		// Unknown code or no ICU data: keep two decimals.
	}
	digitsCache.set(key, digits);
	return digits;
}

/**
 * Minor units → a number in major units (`9900` SEK → `99`, `990` JPY → `990`),
 * as analytics vendors expect. Without a currency two decimals are assumed.
 */
export function toMajorUnits(
	amount: MinorUnits,
	currency?: CurrencyCode | null,
): number {
	const digits = currency ? currencyDecimals(currency) : 2;
	if (digits === 0) return Math.round(amount);
	return Number((amount / 10 ** digits).toFixed(digits));
}

/** Minor units → the decimal string schema.org and OpenGraph expect (`"99.00"`). */
export function formatSchemaPrice(
	amount: MinorUnits,
	currency: CurrencyCode,
): string {
	const digits = currencyDecimals(currency);
	if (digits === 0) return String(Math.round(amount));
	const divisor = 10 ** digits;
	const whole = Math.trunc(amount / divisor);
	const fraction = Math.abs(amount % divisor);
	return `${whole}.${String(fraction).padStart(digits, "0")}`;
}
