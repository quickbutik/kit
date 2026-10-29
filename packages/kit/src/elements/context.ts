/**
 * The W3C community `context-request` protocol. Unlike `closest()`, the
 * request event crosses shadow roots (it is `composed`) and lets a requester
 * stay subscribed to changes, such as a product that resolves asynchronously.
 *
 * @see https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/context.md
 */

/** An opaque, comparable key for one kind of value. */
export interface Context<T> {
	readonly name: string;
	/** Phantom — carries `T` so `requestContext` can infer the callback type. */
	readonly __type?: T;
}

export function createContext<T>(name: string): Context<T> {
	return { name };
}

export type ContextCallback<T> = (value: T, unsubscribe?: () => void) => void;

/**
 * The event itself: a class rather than a `CustomEvent`, as the protocol
 * specifies, so it interoperates with other implementations such as
 * `@lit/context`.
 */
export class ContextRequestEvent<T> extends Event {
	readonly context: Context<T>;
	readonly callback: ContextCallback<T>;
	readonly subscribe: boolean;

	constructor(
		context: Context<T>,
		callback: ContextCallback<T>,
		subscribe = false,
	) {
		super("context-request", { bubbles: true, composed: true });
		this.context = context;
		this.callback = callback;
		this.subscribe = subscribe;
	}
}

export interface ContextProvider {
	/** Re-deliver the current value to every subscriber. */
	update(): void;
	/** Stop answering and drop every subscriber. */
	dispose(): void;
}

/**
 * Answer `context-request` events raised inside `host`.
 *
 * `produce` receives the element that asked, so one provider can hand different
 * values to different parts of its subtree (as repeated rows do). Returning
 * `undefined` declines the request and lets it bubble to an outer provider.
 */
export function provideContext<T>(
	host: EventTarget,
	context: Context<T>,
	produce: (requester: Element) => T | undefined,
): ContextProvider {
	const subscribers = new Map<Element, ContextCallback<T>>();

	const onRequest = (event: Event): void => {
		const request = event as ContextRequestEvent<unknown>;
		if (request.context?.name !== context.name) return;

		const requester = (event.composedPath()[0] ?? event.target) as Element;
		// A provider asking for its own context wants the one above it.
		if (requester === host) return;

		const value = produce(requester);
		// Declined: no `stopPropagation`, so an outer provider still gets a turn.
		if (value === undefined) return;

		event.stopPropagation();
		const callback = request.callback as ContextCallback<T>;
		if (request.subscribe) {
			subscribers.set(requester, callback);
			callback(value, () => subscribers.delete(requester));
		} else {
			callback(value);
		}
	};

	host.addEventListener("context-request", onRequest);

	return {
		update() {
			for (const [requester, callback] of subscribers) {
				// A requester torn out of the document will never unsubscribe itself.
				if (!requester.isConnected) {
					subscribers.delete(requester);
					continue;
				}
				const value = produce(requester);
				if (value !== undefined) {
					callback(value, () => subscribers.delete(requester));
				}
			}
		},
		dispose() {
			host.removeEventListener("context-request", onRequest);
			subscribers.clear();
		},
	};
}

/**
 * Ask for a context value. Returns whether anyone answered, so the caller can
 * fall back (the elements use the ambient shop).
 */
export function requestContext<T>(
	requester: Element,
	context: Context<T>,
	callback: ContextCallback<T>,
	subscribe = false,
): boolean {
	let answered = false;
	requester.dispatchEvent(
		new ContextRequestEvent<T>(
			context,
			(value, unsubscribe) => {
				answered = true;
				callback(value, unsubscribe);
			},
			subscribe,
		),
	);
	return answered;
}
