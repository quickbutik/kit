/**
 * `data-qb-action="…"` — the one way markup asks for something to happen,
 * without a wrapper element per verb.
 *
 * Verbs are handled by the nearest enclosing scope that knows them (a `remove`
 * in a cart row reaches that row first). An unclaimed verb keeps bubbling, and
 * is reported if nothing claims it.
 */

/** Marks an event as claimed, so an outer scope does not run it twice. */
const CLAIMED = Symbol("qb:action-claimed");

interface ClaimableEvent extends Event {
	[CLAIMED]?: true;
}

/**
 * Mark an event as handled outside a `data-qb-action` delegate (as
 * `<qb-add-to-cart>` does), so outer delegates skip it.
 */
export function claimAction(event: Event): void {
	(event as ClaimableEvent)[CLAIMED] = true;
}

export type ActionHandler = (
	/** The element carrying `data-qb-action`. */
	target: HTMLElement,
	event: Event,
) => void;

export interface ActionDelegate {
	dispose(): void;
}

/**
 * Handle the verbs in `handlers` for anything inside `host`, on both `click`
 * and `change` (for a `<select>` or `<input>`).
 */
export function delegateActions(
	host: Element,
	handlers: Record<string, ActionHandler>,
): ActionDelegate {
	const onEvent = (event: Event): void => {
		const claimable = event as ClaimableEvent;
		if (claimable[CLAIMED]) return;

		const origin = event.target;
		if (!(origin instanceof Element)) return;
		const target = origin.closest<HTMLElement>("[data-qb-action]");
		if (!target || !host.contains(target)) return;

		const verb = target.dataset.qbAction;
		if (!verb) return;
		const handler = handlers[verb];
		// Not ours — leave it unclaimed so an outer scope gets its turn.
		if (!handler) return;

		claimable[CLAIMED] = true;
		// On an <a> or a submit button, act instead of navigating.
		if (event.cancelable) event.preventDefault();
		handler(target, event);
	};

	host.addEventListener("click", onEvent);
	host.addEventListener("change", onEvent);

	return {
		dispose() {
			host.removeEventListener("click", onEvent);
			host.removeEventListener("change", onEvent);
		},
	};
}

/**
 * Warn once per verb about actions nobody handled, such as a typo like
 * `data-qb-action="add-tocart"`. Attached at the document by `defineElements`.
 */
export function reportUnclaimedActions(root: Document | Element): () => void {
	const seen = new Set<string>();
	const onClick = (event: Event): void => {
		if ((event as ClaimableEvent)[CLAIMED]) return;
		const origin = event.target;
		if (!(origin instanceof Element)) return;
		const target = origin.closest<HTMLElement>("[data-qb-action]");
		const verb = target?.dataset.qbAction;
		if (!verb || seen.has(verb)) return;
		seen.add(verb);
		console.warn(
			`shopkit: nothing handled data-qb-action="${verb}". Check the spelling, ` +
				"and that the element sits inside the component that owns that action " +
				"(e.g. `select` inside <qb-option-values>, `remove` inside <qb-cart-items>).",
		);
	};
	// Bubble phase: capturing would run before the components claim the event.
	root.addEventListener("click", onClick);
	return () => root.removeEventListener("click", onClick);
}
