/**
 * Every repeated row's root element. The binding walk skips these; their own
 * repeater binds them with the row's scope.
 */
const rowRoots = new WeakSet<Element>();

/** True when `element` is the root of a repeated row. */
export function isRepeatRoot(element: Element): boolean {
	return rowRoots.has(element);
}

/**
 * One rendered row: the top-level elements one `<template>` clone produced
 * (a template may have several, such as `<dt>` and `<dd>`).
 */
export interface RepeatRow {
	key: string;
	roots: Element[];
}

/**
 * Renders a `<template>` once per item, in place, keyed.
 *
 * Rows are matched by key and moved rather than rebuilt, so an `<input>` being
 * typed in keeps its focus and caret. The `<template>` stays where the author
 * put it, and rows are inserted after it.
 */
export class Repeater {
	private rows = new Map<string, RepeatRow>();
	private template: HTMLTemplateElement | null = null;
	private warned = false;

	constructor(private readonly host: Element) {}

	/** True once the host actually has a `<template>` to clone. */
	get hasTemplate(): boolean {
		return this.findTemplate() !== null;
	}

	private findTemplate(): HTMLTemplateElement | null {
		if (this.template?.isConnected) return this.template;
		for (const child of Array.from(this.host.children)) {
			if (child instanceof HTMLTemplateElement) {
				this.template = child;
				return child;
			}
			// Some engines (and happy-dom) do not share the class identity.
			if (child.tagName === "TEMPLATE") {
				this.template = child as HTMLTemplateElement;
				return this.template;
			}
		}
		return null;
	}

	/**
	 * Reconcile the rows against `items`. `fill` runs for surviving rows too,
	 * since the data behind a stable key can change.
	 */
	render<T>(
		items: readonly T[],
		key: (item: T, index: number) => string,
		fill: (row: RepeatRow, item: T, index: number) => void,
	): void {
		const template = this.findTemplate();
		if (!template) {
			if (!this.warned) {
				this.warned = true;
				console.warn(
					`shopkit: <${this.host.tagName.toLowerCase()}> has no <template> child, ` +
						"so there is nothing to repeat. Put the markup for one item in a " +
						"<template> inside it.",
				);
			}
			return;
		}

		const next = new Map<string, RepeatRow>();
		// Rows are inserted after this node, which walks forward as we go, so the
		// final order matches `items` without a second pass.
		let anchor: Node = template;

		items.forEach((item, index) => {
			let rowKey = key(item, index);
			// Disambiguate duplicate keys, or the first row would be left untracked.
			if (next.has(rowKey)) rowKey = `${rowKey}\u0000${index}`;

			const existing = this.rows.get(rowKey);
			const row = existing ?? this.createRow(rowKey, template);
			if (existing) this.rows.delete(rowKey);

			for (const root of row.roots) {
				// Skip nodes already in place, so unchanged lists leave the DOM alone.
				if (anchor.nextSibling !== root) {
					this.host.insertBefore(root, anchor.nextSibling);
				}
				anchor = root;
			}

			fill(row, item, index);
			next.set(rowKey, row);
		});

		// Whatever is left in `this.rows` was not in `items` this time.
		for (const stale of this.rows.values()) {
			for (const root of stale.roots) root.remove();
		}
		this.rows = next;
	}

	private createRow(key: string, template: HTMLTemplateElement): RepeatRow {
		const fragment = template.content.cloneNode(true) as DocumentFragment;
		const roots = Array.from(fragment.children);
		for (const root of roots) rowRoots.add(root);
		return { key, roots };
	}

	/** Remove every row. The `<template>` itself stays. */
	clear(): void {
		for (const row of this.rows.values()) {
			for (const root of row.roots) root.remove();
		}
		this.rows.clear();
	}

	/** The row a node sits inside, for resolving a per-row scope. */
	rowFor(node: Node): RepeatRow | null {
		for (const row of this.rows.values()) {
			for (const root of row.roots) {
				if (root === node || root.contains(node)) return row;
			}
		}
		return null;
	}

	/** Every row currently rendered, in DOM order. */
	get current(): RepeatRow[] {
		return [...this.rows.values()];
	}
}
