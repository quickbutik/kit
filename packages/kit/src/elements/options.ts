import type {
	VariantOptionGroupState,
	VariantOptionValueState,
} from "../state/variant-matrix.js";
import { delegateActions } from "./actions.js";
import { bindRow, type Scope } from "./bindings.js";
import { type ProductContextValue, productContext } from "./product.js";
import { Repeater } from "./repeat.js";
import { QbScopeElement } from "./scope.js";
import { optionGroupScope, optionValueScope } from "./view-model.js";

/**
 * The variant picker, driven entirely by the product. Option names ("Färg",
 * "Storlek") are merchant data, so both the groups and their values come from
 * the product rather than the markup:
 *
 * ```html
 * <qb-options>
 *   <template>
 *     <fieldset>
 *       <legend data-qb-text="group.name"></legend>
 *       <qb-option-values>
 *         <template>
 *           <button data-qb-action="select" data-qb-text="value.name"></button>
 *         </template>
 *       </qb-option-values>
 *     </fieldset>
 *   </template>
 * </qb-options>
 * ```
 *
 * The same template works for any number of options; a product with none
 * renders nothing.
 */

/**
 * Shared plumbing: subscribe to the product above, re-render when the selection
 * moves, and answer scope requests with the row the requester sits in.
 */
abstract class OptionsRepeatElement extends QbScopeElement {
	protected product: ProductContextValue | null = null;
	protected readonly repeater = new Repeater(this);
	private unsubscribeController: (() => void) | null = null;
	/** Row key → the scope that row's markup is bound against. */
	protected readonly rowScopes = new Map<string, Scope>();

	protected start(): void {
		this.initScope();
		this.consume(productContext, (product) => {
			const changed = this.product?.controller !== product.controller;
			this.product = product;
			if (changed) this.watchController();
			this.render();
		});
		if (!this.product) {
			console.warn(
				`shopkit: <${this.tagName.toLowerCase()}> is not inside a <qb-product>, ` +
					"so there is no product to read options from.",
			);
		}
	}

	protected stop(): void {
		this.unsubscribeController?.();
		this.unsubscribeController = null;
		this.repeater.clear();
		this.rowScopes.clear();
	}

	/**
	 * Listen to the product's selection. Only called when the controller
	 * changed: re-adding a listener during the controller's own notification
	 * loop would fire it again in the same pass.
	 */
	private watchController(): void {
		this.unsubscribeController?.();
		this.unsubscribeController =
			this.product?.controller?.subscribe(() => this.render()) ?? null;
	}

	/** The scope for whichever row `requester` is inside. */
	protected scopeFor(requester: Element): Scope | undefined {
		const row = this.repeater.rowFor(requester);
		if (!row) return this.ownScope();
		return this.rowScopes.get(row.key) ?? this.ownScope();
	}

	protected ownScope(): Scope {
		return this.parentScope;
	}
}

/**
 * `<qb-options>` — repeats its `<template>` once per option group the product
 * actually has, in the product's own display order.
 *
 * Scope inside a row: `group.id`, `group.name`, `group.position`,
 * `group.values`, `group.selectedValueId`, `group.chosen`.
 *
 * A product with no options renders nothing and the element is marked `empty`,
 * so `qb-options[empty] { display: none }` hides the surrounding chrome.
 */
export class QbOptionsElement extends OptionsRepeatElement {
	protected start(): void {
		super.start();
		// `<select>` may only contain <option>/<optgroup>, so a repeat element
		// cannot live inside one. `data-qb-select-options` fills the author's
		// <select> instead, and this handles its `change`.
		const onChange = (event: Event): void => {
			const select = event.target;
			if (!(select instanceof HTMLSelectElement)) return;
			if (!select.matches("[data-qb-select-options]")) return;
			const optionId = Number(select.dataset.qbOptionId);
			const valueId = Number(select.value);
			if (!Number.isFinite(optionId) || !Number.isFinite(valueId)) return;
			this.product?.controller?.select(optionId, valueId);
		};
		this.addEventListener("change", onChange);
		this.cleanups.push(() => this.removeEventListener("change", onChange));
	}

	protected render(): void {
		const groups = this.product?.controller?.getSnapshot().options ?? [];
		this.toggleAttr("empty", groups.length === 0);
		this.rowScopes.clear();

		this.repeater.render(
			groups,
			(group) => String(group.id),
			(row, group) => {
				const scope: Scope = {
					...this.parentScope,
					...optionGroupScope(group),
				};
				this.rowScopes.set(row.key, scope);
				for (const root of row.roots) {
					reflectGroup(root, group);
					fillSelects(root, group);
				}
				bindRow(row.roots, scope);
			},
		);

		super.render();
	}
}

/**
 * `<qb-option-values>` — repeats its `<template>` once per value of the group
 * it sits in.
 *
 * Nested inside a `<qb-options>` row it needs no attributes at all: the group
 * comes from the row's scope. Scope inside a value row: `value.id`,
 * `value.name`, `value.selected`, `value.available`, `value.unavailable`,
 * `value.variantIds` — plus everything the enclosing scopes offered.
 *
 * Each row's top-level elements get `data-selected` and `data-available`
 * reflected (and `aria-pressed` on a button), so unavailable combinations are
 * a stylesheet's concern. They are not disabled; see `reflectValue`.
 *
 * `option="<id or name>"` targets one group explicitly, e.g. swatches for one
 * group only. Never required; a name only matches products whose merchant used
 * that exact option name.
 */
export class QbOptionValuesElement extends OptionsRepeatElement {
	static observedAttributes = ["option"];

	protected start(): void {
		super.start();
		const actions = delegateActions(this, {
			select: (target) => this.selectFrom(target),
		});
		this.cleanups.push(() => actions.dispose());
	}

	protected update(): void {
		this.render();
	}

	protected render(): void {
		const group = this.resolveGroup();
		this.toggleAttr("empty", group === null);
		this.rowScopes.clear();

		if (!group) {
			this.repeater.clear();
			super.render();
			return;
		}

		this.repeater.render(
			group.values,
			(value) => String(value.id),
			(row, value) => {
				const scope: Scope = {
					...this.parentScope,
					...optionGroupScope(group),
					...optionValueScope(value),
				};
				this.rowScopes.set(row.key, scope);
				for (const root of row.roots) {
					reflectValue(root, value);
				}
				bindRow(row.roots, scope);
			},
		);

		super.render();
	}

	/**
	 * The group whose values to render: the enclosing `<qb-options>` row, else
	 * the `option` id or name, else the product's only group.
	 */
	private resolveGroup(): VariantOptionGroupState | null {
		const groups = this.product?.controller?.getSnapshot().options ?? [];
		if (groups.length === 0) return null;

		const inherited = this.parentScope.group as
			| { id?: number }
			| undefined
			| null;
		if (inherited?.id !== undefined) {
			return groups.find((group) => group.id === inherited.id) ?? null;
		}

		const named = this.attr("option");
		if (named !== undefined) {
			const byId = Number(named);
			if (Number.isFinite(byId)) {
				const found = groups.find((group) => group.id === byId);
				if (found) return found;
			}
			const wanted = named.toLowerCase();
			return (
				groups.find((group) => (group.name ?? "").toLowerCase() === wanted) ??
				null
			);
		}

		if (groups.length === 1) return groups[0] ?? null;

		console.warn(
			"shopkit: <qb-option-values> is not inside a <qb-options> row and the " +
				`product has ${groups.length} option groups, so there is no way to ` +
				"tell which one it means. Nest it in <qb-options> to render them all.",
		);
		return null;
	}

	private selectFrom(target: HTMLElement): void {
		const row = this.repeater.rowFor(target);
		const scope = row ? this.rowScopes.get(row.key) : undefined;
		const value = scope?.value as
			| { id?: number; optionId?: number }
			| undefined;
		if (value?.id === undefined || value.optionId === undefined) return;
		this.product?.controller?.select(value.optionId, value.id);
	}
}

// State reflection, so styling never needs JavaScript

function reflectGroup(root: Element, group: VariantOptionGroupState): void {
	root.setAttribute(
		"data-chosen",
		group.selectedValueId === null ? "false" : "true",
	);
	root.setAttribute("data-option-id", String(group.id));
}

/** Populate every `<select data-qb-select-options>` in a group's row. */
function fillSelects(root: Element, group: VariantOptionGroupState): void {
	const selects = collectSelects(root);
	for (const select of selects) {
		select.dataset.qbOptionId = String(group.id);

		// Keep the author's placeholders ("Välj storlek"): options with no value
		// or with `data-qb-placeholder`.
		const placeholders = Array.from(select.options).filter(
			(option) =>
				option.value === "" || option.hasAttribute("data-qb-placeholder"),
		);
		select.replaceChildren(...placeholders);

		for (const value of group.values) {
			const option = document.createElement("option");
			option.value = String(value.id);
			option.textContent = value.name ?? String(value.id);
			option.disabled = !value.available;
			option.selected = value.selected;
			select.append(option);
		}
		select.value =
			group.selectedValueId === null ? "" : String(group.selectedValueId);
	}
}

function collectSelects(root: Element): HTMLSelectElement[] {
	const found = Array.from(
		root.querySelectorAll<HTMLSelectElement>("select[data-qb-select-options]"),
	);
	if (
		root instanceof HTMLSelectElement &&
		root.matches("[data-qb-select-options]")
	) {
		found.unshift(root);
	}
	return found;
}

/**
 * Reflect a value's state, deliberately without disabling it.
 *
 * Selecting an unavailable value repairs the selection rather than being
 * refused (pick Red when Red has no XXL, and the size is cleared), so
 * disabling it could strand the shopper. Style `data-available="false"`
 * instead, or put `disabled` in your own template; nothing here overwrites it.
 */
function reflectValue(root: Element, value: VariantOptionValueState): void {
	root.setAttribute("data-value-id", String(value.id));
	root.setAttribute("data-selected", String(value.selected));
	root.setAttribute("data-available", String(value.available));

	if (root.tagName === "BUTTON" || root.hasAttribute("role")) {
		root.setAttribute("aria-pressed", String(value.selected));
	}
}
