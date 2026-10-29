import { QbElement } from "./base.js";
import { bindSubtree, type Scope, scopeContext } from "./bindings.js";
import { type ContextProvider, provideContext } from "./context.js";

/**
 * An element that contributes to the view model its subtree is bound against.
 *
 * Scopes nest by extension, never by replacement: `<qb-option-values>` inside a
 * `<qb-options>` row sees `product`, `price`, `group` **and** `value`.
 */
export abstract class QbScopeElement extends QbElement {
	private provider: ContextProvider | null = null;
	/** Whatever the enclosing scope offered. Empty at the top level. */
	protected parentScope: Scope = {};

	/** This element's own contribution, already merged with `parentScope`. */
	protected abstract ownScope(): Scope;

	/**
	 * The scope for one requester inside this element. Repeating elements
	 * override it to answer with the scope of the requester's row.
	 */
	protected scopeFor(_requester: Element): Scope | undefined {
		return this.ownScope();
	}

	/**
	 * Join the scope chain: subscribe to the scope above, offer ours below.
	 * Call it first in `start()`, so the first render has the parent's values.
	 */
	protected initScope(): void {
		this.consume(scopeContext, (scope) => {
			this.parentScope = scope;
			this.render();
		});
		this.provider = provideContext(this, scopeContext, (requester) =>
			this.scopeFor(requester),
		);
		this.cleanups.push(() => {
			this.provider?.dispose();
			this.provider = null;
		});
	}

	/**
	 * Re-bind this element's own markup and push the new scope to everything
	 * below. Repeating subclasses reconcile their rows first.
	 */
	protected render(): void {
		bindSubtree(this, this.ownScope());
		this.provider?.update();
	}

	/** Push a changed scope downward without re-binding our own markup. */
	protected notifyScope(): void {
		this.provider?.update();
	}
}
