import { vi } from "vitest";

/**
 * Give an iframe a `contentWindow` the bridge can talk to.
 *
 * happy-dom only builds one when it has actually loaded a document into the
 * frame, which for a cross-origin checkout URL would mean a real network
 * request (see `tests/setup.ts`). A real browser hands the host an opaque
 * cross-origin `Window` whose only usable member is `postMessage` — which is
 * exactly what this is, defined as an own property so it shadows the prototype
 * getter.
 *
 * This is the seam that makes the host side testable, and also its limit: the
 * frame is a stub, so these tests prove what the HOST does with a message, not
 * that a real checkout document sends one. The frame side is tested in the
 * checkout's own suite, against the same shared fixtures.
 */
export function stubFrameWindow(iframe: HTMLIFrameElement): {
	frameWindow: Window;
	posted: () => unknown[];
} {
	const postMessage = vi.fn();
	const frameWindow = { postMessage } as unknown as Window;
	Object.defineProperty(iframe, "contentWindow", {
		value: frameWindow,
		configurable: true,
	});
	return {
		frameWindow,
		posted: () => postMessage.mock.calls.map((call) => call[0]),
	};
}

/** Dispatch a `message` as if the embedded checkout had sent it. */
export function sendFromFrame(
	data: unknown,
	options: { origin?: string; source?: unknown } = {},
): void {
	window.dispatchEvent(
		new MessageEvent("message", {
			data,
			origin: options.origin ?? "https://checkout.test",
			source: (options.source ?? null) as MessageEventSource | null,
		}),
	);
}

/** The iframe an embed handle mounted into `host`, or a failure that says so. */
export function frameIn(host: HTMLElement): HTMLIFrameElement {
	const found = host.querySelector("iframe");
	if (!found) throw new Error("no iframe was mounted");
	return found;
}
