import { type CurrencyInfo, describeCurrency } from "../sdk/currency.js";
import type { Shop, ShopCurrency } from "../sdk/types/shop.js";
import { getShopPromise } from "../state/shop-cache.js";
import { delegateActions } from "./actions.js";
import { bindRow, type Scope } from "./bindings.js";
import { Repeater } from "./repeat.js";
import { QbScopeElement } from "./scope.js";
import type { ShopContextValue } from "./shop-context.js";

/**
 * `<qb-currency-select>` — let the shopper pick the currency the shop is
 * browsed in.
 *
 * Three ways to write it, from least to most markup:
 *
 * ```html
 * <!-- 1. Nothing inside: a native <select> of the shop's currencies is added -->
 * <qb-currency-select></qb-currency-select>
 *
 * <!-- 2. Your own <select>: filled with the currencies (a value="" placeholder
 *      is kept), or left alone when you wrote the options yourself -->
 * <qb-currency-select>
 *   <label>Valuta <select class="my-select"></select></label>
 * </qb-currency-select>
 *
 * <!-- 3. A <template>: one clone per currency, any markup at all -->
 * <qb-currency-select>
 *   <template>
 *     <button data-qb-action="set-currency" data-qb-text="option.code"></button>
 *   </template>
 * </qb-currency-select>
 * ```
 *
 * Choosing calls `client.setCurrency()`: the choice is remembered, and products
 * and the cart are re-priced in it. A `"display"` currency is shown converted
 * and charged in the shop's currency at checkout; a `"charge"` currency is
 * priced and charged in it.
 *
 * Scope: `currency.code` (what prices are shown in), `currency.base`,
 * `currency.mode` (`base` / `display` / `charge`), `currency.chargeCurrency`,
 * `currency.count`; inside a template row, `option.code`, `option.label`,
 * `option.name`, `option.mode`, `option.rate`, `option.selected`,
 * `option.base`. Rows get `data-selected` and `data-currency`.
 *
 * Reflects `state`, `data-currency`, `data-mode`, and `empty` when the shop
 * offers only its own currency. Emits `qb:currency-change` with
 * `{ currency }` after a choice. `label="name"` (or `"code-name"`) labels the
 * options with the currency's name in `locale`.
 *
 * Reads the shop with `shop.get()`, so the key needs `checkout:read` (every
 * standard storefront key has it).
 */
export class QbCurrencySelectElement extends QbScopeElement {
	static observedAttributes = ["label", "locale"];

	private shop: ShopContextValue | null = null;
	private shopData: Shop | null = null;
	private readonly repeater = new Repeater(this);
	private readonly rowScopes = new Map<string, Scope>();
	private generated: HTMLSelectElement | null = null;

	/** What the current choice means for this shop, or null before it loads. */
	get info(): CurrencyInfo | null {
		if (!this.shop || !this.shopData) return null;
		return describeCurrency(this.shopData, this.shop.client.currency);
	}

	protected start(): void {
		this.initScope();

		const actions = delegateActions(this, {
			"set-currency": (target) => {
				const code =
					target.dataset.qbCurrency ?? this.rowCode(target) ?? undefined;
				if (code) void this.choose(code);
			},
		});
		this.cleanups.push(() => actions.dispose());

		const onChange = (event: Event): void => {
			const select = event.target;
			if (!(select instanceof HTMLSelectElement)) return;
			if (!this.ownsSelect(select) || select.value === "") return;
			void this.choose(select.value);
		};
		this.addEventListener("change", onChange);
		this.cleanups.push(() => this.removeEventListener("change", onChange));

		this.withShop(
			(shop) => {
				const changedShop = this.shop?.client !== shop.client;
				this.shop = shop;
				if (changedShop) {
					this.shopData = null;
					void this.loadShop(shop);
				}
				this.render();
			},
			// Re-render so the selection follows a switch made elsewhere on the page.
			{ refetchOnCurrencyChange: true },
		);
	}

	protected update(): void {
		this.render();
	}

	protected stop(): void {
		this.repeater.clear();
		this.rowScopes.clear();
		// The added <select> is kept and reused on reconnect.
	}

	/** Switch currency, exactly as a shopper's choice does. */
	async choose(code: string): Promise<void> {
		if (!this.shop) return;
		try {
			await this.shop.client.setCurrency(code);
			this.emit("currency-change", { currency: this.shop.client.currency });
		} catch (error) {
			this.fail(error, "<qb-currency-select> could not switch currency");
		}
	}

	private async loadShop(shop: ShopContextValue): Promise<void> {
		this.setState("loading");
		try {
			const data = await getShopPromise(shop.client);
			if (this.shop !== shop) return;
			this.shopData = data;
			this.setState("ready");
			this.render();
		} catch (error) {
			if (this.shop === shop) {
				this.fail(error, "<qb-currency-select> could not load the shop");
			}
		}
	}

	protected scopeFor(requester: Element): Scope | undefined {
		const row = this.repeater.rowFor(requester);
		if (!row) return this.ownScope();
		return this.rowScopes.get(row.key) ?? this.ownScope();
	}

	protected ownScope(): Scope {
		const info = this.info;
		return {
			...this.parentScope,
			currency: {
				code: info?.currency ?? this.shop?.client.currency ?? null,
				base: info?.baseCurrency ?? null,
				mode: info?.mode ?? "base",
				rate: info?.rate ?? 1,
				chargeCurrency: info?.chargeCurrency ?? null,
				count: info?.currencies.length ?? 0,
			},
		};
	}

	protected render(): void {
		const info = this.info;
		const currencies = info?.currencies ?? [];
		const selected = info?.currency ?? null;
		const locale = this.attr("locale") ?? this.shop?.locale;
		const labelStyle = this.attr("label") ?? "code";

		this.toggleAttr("empty", currencies.length <= 1);
		this.reflect("data-currency", selected);
		this.reflect("data-mode", info?.mode ?? null);

		const options = currencies.map((entry) =>
			optionView(entry, selected, labelStyle, locale),
		);

		if (this.repeater.hasTemplate) {
			const parent = this.ownScope();
			this.rowScopes.clear();
			this.repeater.render(
				options,
				(option) => option.code,
				(row, option) => {
					const scope: Scope = { ...parent, option };
					this.rowScopes.set(row.key, scope);
					for (const root of row.roots) {
						root.setAttribute("data-currency", option.code);
						root.setAttribute("data-selected", String(option.selected));
						if (root.tagName === "BUTTON") {
							root.setAttribute("aria-pressed", String(option.selected));
						}
					}
					bindRow(row.roots, scope);
				},
			);
		} else {
			for (const select of this.selects()) {
				fillSelect(select, options, selected);
			}
		}

		super.render();
	}

	/**
	 * The `<select>`s this element drives: the author's own, outside any
	 * template, or else one it adds itself.
	 */
	private selects(): HTMLSelectElement[] {
		const own = Array.from(this.querySelectorAll("select")).filter(
			(select) => select !== this.generated && this.ownsSelect(select),
		);
		if (own.length > 0) {
			this.generated?.remove();
			this.generated = null;
			return own;
		}
		// Static set-currency buttons are a picker already.
		if (this.querySelector('[data-qb-action="set-currency"]')) return [];
		if (!this.generated) {
			const select = document.createElement("select");
			select.setAttribute("aria-label", "Currency");
			select.dataset.qbGenerated = "";
			this.append(select);
			this.generated = select;
		}
		return [this.generated];
	}

	/** A `<select>` inside this element and not inside a template row. */
	private ownsSelect(select: HTMLSelectElement): boolean {
		if (!this.contains(select)) return false;
		return this.repeater.rowFor(select) === null;
	}

	private rowCode(target: HTMLElement): string | null {
		const row = this.repeater.rowFor(target);
		const scope = row ? this.rowScopes.get(row.key) : undefined;
		const option = scope?.option as { code?: string } | undefined;
		return option?.code ?? null;
	}

	private reflect(name: string, value: string | null): void {
		if (value === null) this.removeAttribute(name);
		else if (this.getAttribute(name) !== value) this.setAttribute(name, value);
	}
}

interface CurrencyOptionView {
	code: string;
	/** What the option says, per the `label` attribute. */
	label: string;
	/** The currency's name in the locale ("euro"), or the code when unknown. */
	name: string;
	mode: ShopCurrency["mode"];
	rate: number;
	selected: boolean;
	/** True for the shop's own currency. */
	base: boolean;
}

function optionView(
	entry: ShopCurrency,
	selected: string | null,
	labelStyle: string,
	locale: string | undefined,
): CurrencyOptionView {
	const code = entry.code.toUpperCase();
	const name = currencyName(code, locale);
	const label =
		labelStyle === "name"
			? name
			: labelStyle === "code-name" && name !== code
				? `${code} – ${name}`
				: code;
	return {
		code,
		label,
		name,
		mode: entry.mode,
		rate: entry.rate,
		selected: code === selected,
		base: entry.mode === "base",
	};
}

function currencyName(code: string, locale: string | undefined): string {
	try {
		return (
			new Intl.DisplayNames(locale ? [locale] : undefined, {
				type: "currency",
			}).of(code) ?? code
		);
	} catch {
		return code;
	}
}

/**
 * Fill a `<select>` with the currencies, reconciled rather than rebuilt so an
 * open dropdown is not closed by a re-render. A select with author-written
 * options only has its value set.
 */
function fillSelect(
	select: HTMLSelectElement,
	options: CurrencyOptionView[],
	selected: string | null,
): void {
	const authored = Array.from(select.options).some(
		(option) =>
			option.value !== "" && !option.hasAttribute("data-qb-generated"),
	);
	if (!authored) {
		const placeholders = Array.from(select.options).filter(
			(option) => option.value === "",
		);
		const existing = new Map(
			Array.from(select.options)
				.filter((option) => option.value !== "")
				.map((option) => [option.value, option]),
		);
		const next: HTMLOptionElement[] = [...placeholders];
		for (const view of options) {
			const option =
				existing.get(view.code) ?? document.createElement("option");
			option.value = view.code;
			option.setAttribute("data-qb-generated", "");
			if (option.textContent !== view.label) option.textContent = view.label;
			next.push(option);
		}
		const same =
			next.length === select.options.length &&
			next.every((option, index) => select.options[index] === option);
		if (!same) select.replaceChildren(...next);
		select.disabled = options.length <= 1;
	}
	// Authored values may be lower-case ("eur"); match them as the platform does.
	const match = Array.from(select.options).find(
		(option) => option.value.toUpperCase() === selected,
	);
	if (match && select.value !== match.value) select.value = match.value;
}
