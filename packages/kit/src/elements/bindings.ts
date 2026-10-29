import { type Context, createContext } from "./context.js";
import { isRepeatRoot } from "./repeat.js";

/**
 * The view model a subtree's bindings are resolved against.
 *
 * Plain data: `data-qb-text="price.formatted"` is a **path**, not an
 * expression, so there is no evaluator and nothing a template can execute.
 */
export type Scope = Record<string, unknown>;

export const scopeContext: Context<Scope> =
	createContext<Scope>("quickbutik:scope");

/**
 * Tag names that own a scope of their own. The binding walk stops at these;
 * they bind their own subtree with an extended scope. Registered at
 * definition time, since the prefix is configurable.
 */
const scopeOwners = new Set<string>();

export function markScopeOwner(tagName: string): void {
	scopeOwners.add(tagName.toUpperCase());
}

export function isScopeOwner(element: Element): boolean {
	return scopeOwners.has(element.tagName);
}

/** For tests: forget the registered owners so a fresh prefix can be used. */
export function clearScopeOwners(): void {
	scopeOwners.clear();
}

// Path resolution

/**
 * Resolve `"product.images.0.url"` against the scope. Missing anywhere →
 * `undefined`, never a throw.
 */
export function resolvePath(scope: Scope, path: string): unknown {
	let current: unknown = scope;
	for (const segment of path.split(".")) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function toText(value: unknown): string {
	if (value === null || value === undefined || value === false) return "";
	return String(value);
}

// Directives

/**
 * `"src:image.src, alt:image.alt"` → pairs. A value of null/undefined/false
 * removes the attribute (so `data-qb-attr="disabled:value.soldOut"` behaves the
 * way HTML boolean attributes do); `true` sets it to the empty string.
 */
function parsePairs(spec: string): Array<[string, string]> {
	const pairs: Array<[string, string]> = [];
	for (const part of spec.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const colon = trimmed.indexOf(":");
		if (colon === -1) continue;
		const name = trimmed.slice(0, colon).trim();
		const path = trimmed.slice(colon + 1).trim();
		if (name && path) pairs.push([name, path]);
	}
	return pairs;
}

function applyElementBindings(element: Element, scope: Scope): void {
	const dataset = (element as HTMLElement).dataset;
	if (!dataset) return;

	if (dataset.qbText !== undefined) {
		element.textContent = toText(resolvePath(scope, dataset.qbText));
	}

	if (dataset.qbHtml !== undefined) {
		// Merchant product copy is HTML. It comes from the shop's own API, the
		// same trust domain as the page.
		element.innerHTML = toText(resolvePath(scope, dataset.qbHtml));
	}

	if (dataset.qbAttr !== undefined) {
		for (const [name, path] of parsePairs(dataset.qbAttr)) {
			const value = resolvePath(scope, path);
			if (value === null || value === undefined || value === false) {
				element.removeAttribute(name);
			} else {
				element.setAttribute(name, value === true ? "" : String(value));
			}
		}
	}

	if (dataset.qbClass !== undefined) {
		for (const [name, path] of parsePairs(dataset.qbClass)) {
			element.classList.toggle(name, Boolean(resolvePath(scope, path)));
		}
	}

	if (dataset.qbShow !== undefined) {
		(element as HTMLElement).hidden = !resolvePath(scope, dataset.qbShow);
	}

	if (dataset.qbHide !== undefined) {
		(element as HTMLElement).hidden = Boolean(
			resolvePath(scope, dataset.qbHide),
		);
	}

	if (dataset.qbValue !== undefined) {
		const input = element as HTMLInputElement;
		const next = toText(resolvePath(scope, dataset.qbValue));
		// Only when it differs, so typing does not lose the caret.
		if (input.value !== next) input.value = next;
	}
}

/**
 * Apply every binding **inside** `host`, not on `host` itself (its attributes
 * are configuration). The walk stops at nested scope owners, which bind with
 * their own extended scope.
 */
export function bindSubtree(host: Element, scope: Scope): void {
	walkChildren(host, scope);
}

function walkChildren(parent: Element, scope: Scope): void {
	for (const child of Array.from(parent.children)) {
		// A template's content is a blueprint for future clones.
		if (child.tagName === "TEMPLATE") continue;
		if (isScopeOwner(child)) continue;
		// Repeated rows are bound by their repeater, with the row's scope.
		if (isRepeatRoot(child)) continue;
		applyElementBindings(child, scope);
		walkChildren(child, scope);
	}
}

/**
 * Bind a repeated row, including its top-level elements (unlike
 * {@link bindSubtree}). A root that owns a scope is skipped; it requests its
 * scope through context.
 */
export function bindRow(roots: readonly Element[], scope: Scope): void {
	for (const root of roots) {
		if (isScopeOwner(root) || root.tagName === "TEMPLATE") continue;
		applyElementBindings(root, scope);
		walkChildren(root, scope);
	}
}
