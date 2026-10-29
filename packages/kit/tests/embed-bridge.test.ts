import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	EmbeddedCheckout,
	type EmbeddedCheckoutInitEmbed,
} from "../src/sdk/embed/bridge.js";
import { sendFromFrame, stubFrameWindow } from "./embed-helpers.js";
import { embedFrameMessageFixtures } from "./fixtures/embed-messages.fixtures.js";

const CHECKOUT_ORIGIN = "https://checkout.test";
const EMBED_URL = `${CHECKOUT_ORIGIN}/embed/42/sess-1`;
const HOSTED_URL = `${CHECKOUT_ORIGIN}/checkout/42/sess-1`;

function mountBridge(options: Partial<EmbeddedCheckoutInitEmbed> = {}): {
	handle: EmbeddedCheckout;
	iframe: HTMLIFrameElement;
	container: HTMLElement;
	send: (data: unknown, over?: { origin?: string; source?: unknown }) => void;
	posted: () => unknown[];
} {
	const container = document.createElement("div");
	document.body.append(container);
	const handle = new EmbeddedCheckout({
		mode: "embed",
		container,
		url: EMBED_URL,
		checkoutOrigin: CHECKOUT_ORIGIN,
		sessionId: "sess-1",
		successUrl: "https://shop.test/thanks",
		fallbackUrl: HOSTED_URL,
		handshakeTimeoutMs: 50,
		...options,
	});
	live.push(handle);
	const iframe = handle.iframe as HTMLIFrameElement;
	const { frameWindow, posted } = stubFrameWindow(iframe);

	return {
		handle,
		iframe,
		container,
		send: (data, over = {}) =>
			sendFromFrame(data, {
				origin: over.origin,
				source: "source" in over ? over.source : frameWindow,
			}),
		posted,
	};
}

const READY = embedFrameMessageFixtures.ready;

/**
 * Every handle a test built, destroyed after it.
 *
 * A handle nobody destroys keeps its handshake timer, and since a silent frame
 * navigates to the hosted checkout, a timer left over from one test would call
 * `location.assign` in the middle of the next — against whatever spy that test
 * happens to have installed.
 */
const live: EmbeddedCheckout[] = [];

// Every mount appends a container, and a POST redirect appends a form; a shared
// document would otherwise make the second assertion in a file read the first
// test's DOM.
beforeEach(() => {
	document.body.innerHTML = "";
});

afterEach(() => {
	for (const handle of live.splice(0)) handle.destroy();
});

describe("the iframe", () => {
	it("carries exactly the attributes the contract prescribes", () => {
		const { iframe } = mountBridge({ title: "Kassa", minHeight: 400 });

		expect(iframe.getAttribute("src")).toBe(EMBED_URL);
		expect(iframe.getAttribute("title")).toBe("Kassa");
		expect(iframe.getAttribute("allow")).toBe("payment");
		expect(iframe.getAttribute("referrerpolicy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(iframe.style.width).toBe("100%");
		// Browsers normalize `border: 0` to `0px`; happy-dom keeps whichever the
		// source wrote, so both spellings are the same answer here.
		expect(iframe.style.border).toMatch(/^0(px)?$/);
		expect(iframe.style.height).toBe("400px");
	});

	it("leaves the merchant no stray gap and no ground of its own", () => {
		// Both are about the frame not adding anything the merchant has to undo
		// from their side. `inline` (the default) would sit the frame on the text
		// baseline and leave descender space underneath it that reads as a margin
		// below the checkout; a painted background would put an opaque rectangle
		// over the ground the host page chose, which the checkout document is
		// deliberately transparent to let through.
		const { iframe } = mountBridge();

		expect(iframe.style.display).toBe("block");
		expect(iframe.style.background).toBe("transparent");
	});

	it("has NO sandbox attribute", () => {
		// A sandboxed frame has the opaque origin "null", which the contract
		// rejects on sight, and it would block the nested 3-D Secure iframes.
		const { iframe } = mountBridge();
		expect(iframe.hasAttribute("sandbox")).toBe(false);
	});

	it("defaults its accessible name", () => {
		expect(mountBridge().iframe.getAttribute("title")).toBe("Checkout");
	});
});

describe("one checkout per container", () => {
	it("destroys the earlier handle before framing the new one", async () => {
		// Not two orders — the platform hands the same cart the same session — but
		// two frames, two listeners and two handshake timers, and a checkout
		// stacked on a checkout. Last mount wins.
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = mountBridge({ handshakeTimeoutMs: 10 });
		const firstFallback = vi.fn();
		first.handle.on("fallback", firstFallback);

		const second = mountBridge({
			container: first.container,
			handshakeTimeoutMs: 10_000,
		});

		expect(first.container.querySelectorAll("iframe")).toHaveLength(1);
		expect(first.iframe.isConnected).toBe(false);
		expect(second.iframe.isConnected).toBe(true);

		// The first handle's timer, listener and handlers are gone with it.
		first.send(READY);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(first.posted()).toHaveLength(0);
		expect(firstFallback).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();

		// And the second one is live.
		second.send(READY);
		expect(second.posted()).toHaveLength(1);
		vi.restoreAllMocks();
	});

	it("leaves a handle in another container alone", () => {
		const first = mountBridge();
		const second = mountBridge();
		expect(first.iframe.isConnected).toBe(true);
		expect(second.iframe.isConnected).toBe(true);
	});

	it("forgets a destroyed handle, so a later mount has nothing to destroy", () => {
		const first = mountBridge();
		first.handle.destroy();
		const destroyAgain = vi.spyOn(first.handle, "destroy");
		mountBridge({ container: first.container });
		expect(destroyAgain).not.toHaveBeenCalled();
	});
});

describe("the sender check", () => {
	it("answers a ready from its own frame", () => {
		const { send, posted } = mountBridge();
		send(READY);
		expect(posted()).toHaveLength(1);
		expect(posted()[0]).toMatchObject({ type: "init" });
	});

	it("ignores a message from another origin", () => {
		const { send, posted } = mountBridge();
		send(READY, { origin: "https://evil.test" });
		expect(posted()).toHaveLength(0);
	});

	it("ignores a message from another window on the RIGHT origin", () => {
		// A second Quickbutik frame, or a popup: same origin, not our frame, and
		// it must not be able to drive this handle's navigation.
		const { send, posted } = mountBridge();
		send(READY, { source: window });
		expect(posted()).toHaveLength(0);
	});

	it("ignores a message with no source window at all", () => {
		const { send, posted } = mountBridge();
		send(READY, { source: null });
		expect(posted()).toHaveLength(0);
	});
});

describe("the handshake", () => {
	it("answers every ready, not just the first", () => {
		// What makes a reload recover: a frame that has restarted has forgotten
		// everything the host told it.
		const { send, posted } = mountBridge();
		send(READY);
		send(READY);
		expect(posted()).toHaveLength(2);
		expect(posted()[1]).toMatchObject({ type: "init" });
	});

	it("sends the host URL and viewport with init", () => {
		const { send, posted } = mountBridge();
		send(READY);
		expect(posted()[0]).toMatchObject({
			type: "init",
			hostUrl: window.location.href,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				scrollY: window.scrollY,
			},
		});
	});

	describe("when the frame never answers", () => {
		let assign: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			assign = vi.fn();
			vi.spyOn(window.location, "assign").mockImplementation(
				assign as unknown as (url: string | URL) => void,
			);
			vi.spyOn(console, "warn").mockImplementation(() => {});
		});

		afterEach(() => vi.restoreAllMocks());

		it("takes the frame down and falls back to the hosted checkout", async () => {
			// The shopper sees an empty box either way; the browser tells only the
			// frame's own console that `frame-ancestors` refused it. From out here
			// the one thing the host can do is what the pre-frame fallbacks do.
			const { handle, container, iframe } = mountBridge({
				handshakeTimeoutMs: 10,
			});
			const fallbacks: unknown[] = [];
			const errors = vi.fn();
			handle.on("fallback", (detail) => fallbacks.push(detail));
			handle.on("error", errors);

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(fallbacks).toEqual([
				{ reason: "handshake-timeout", url: HOSTED_URL },
			]);
			expect(errors).not.toHaveBeenCalled();
			expect(handle.state).toBe("fallback");
			expect(handle.iframe).toBeNull();
			expect(iframe.isConnected).toBe(false);
			expect(container.querySelector("iframe")).toBeNull();
			expect(assign).toHaveBeenCalledWith(HOSTED_URL);
			expect(console.warn).toHaveBeenCalledTimes(1);
		});

		it("emits before it navigates, so the listener can still see the page", async () => {
			const { handle } = mountBridge({ handshakeTimeoutMs: 10 });
			let assignedWhenHeard: number | undefined;
			handle.on("fallback", () => {
				assignedWhenHeard = assign.mock.calls.length;
			});

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(assignedWhenHeard).toBe(0);
			expect(assign).toHaveBeenCalledTimes(1);
		});

		it("removes the frame but stays put when the caller opted out of the redirect", async () => {
			const { handle, container } = mountBridge({
				handshakeTimeoutMs: 10,
				fallbackRedirect: false,
			});
			const fallbacks = vi.fn();
			handle.on("fallback", fallbacks);

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(fallbacks).toHaveBeenCalledWith({
				reason: "handshake-timeout",
				url: HOSTED_URL,
			});
			expect(container.querySelector("iframe")).toBeNull();
			expect(handle.state).toBe("fallback");
			expect(assign).not.toHaveBeenCalled();
		});

		it("reports a null url, and navigates nowhere, when no hosted URL is known", async () => {
			const { handle } = mountBridge({
				handshakeTimeoutMs: 10,
				fallbackUrl: null,
			});
			const fallbacks = vi.fn();
			handle.on("fallback", fallbacks);

			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(fallbacks).toHaveBeenCalledWith({
				reason: "handshake-timeout",
				url: null,
			});
			expect(handle.iframe).toBeNull();
			expect(assign).not.toHaveBeenCalled();
		});

		it("stops listening to the frame it took down", async () => {
			const { handle, send, posted } = mountBridge({ handshakeTimeoutMs: 10 });
			const ready = vi.fn();
			handle.on("ready", ready);
			await new Promise((resolve) => setTimeout(resolve, 30));

			// A frame that finally answers after the deadline is no longer ours;
			// re-attaching to it would put a second checkout under a shopper who
			// has already been sent to the hosted one.
			send(READY);

			expect(ready).not.toHaveBeenCalled();
			expect(posted()).toHaveLength(0);
		});

		it("can still be destroyed afterwards, and stays quiet", async () => {
			const { handle } = mountBridge({ handshakeTimeoutMs: 10 });
			const fallbacks = vi.fn();
			handle.on("fallback", fallbacks);
			await new Promise((resolve) => setTimeout(resolve, 30));

			expect(() => handle.destroy()).not.toThrow();
			expect(fallbacks).toHaveBeenCalledTimes(1);
		});
	});

	it("does not fall back on a frame that did answer", async () => {
		const { handle, iframe, send } = mountBridge({ handshakeTimeoutMs: 10 });
		const fallbacks = vi.fn();
		const errors = vi.fn();
		handle.on("fallback", fallbacks);
		handle.on("error", errors);
		send(READY);

		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(fallbacks).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
		expect(handle.state).toBe("embed");
		expect(iframe.isConnected).toBe(true);
	});
});

describe("height", () => {
	it("follows the frame's content", () => {
		const { iframe, send } = mountBridge({ minHeight: 200 });
		send(embedFrameMessageFixtures.height);
		expect(iframe.style.height).toBe("1284px");
	});

	it("never drops below min-height", () => {
		const { iframe, send } = mountBridge({ minHeight: 900 });
		send({ ...embedFrameMessageFixtures.height, height: 120 });
		expect(iframe.style.height).toBe("900px");
	});
});

describe("navigation", () => {
	let assign: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("performs a navigate", () => {
		const { send } = mountBridge();
		send(embedFrameMessageFixtures.navigate);
		expect(assign).toHaveBeenCalledWith("https://shop.example.com/cart");
	});

	it("performs a GET redirect on the top window", () => {
		const { send } = mountBridge();
		send(embedFrameMessageFixtures.redirectGet);
		expect(assign).toHaveBeenCalledWith(
			embedFrameMessageFixtures.redirectGet.url,
		);
	});

	it("reports but does not perform when handleNavigation is off", () => {
		const { handle, send } = mountBridge({ handleNavigation: false });
		const seen: unknown[] = [];
		handle.on("navigate", (detail) => seen.push(detail));
		send(embedFrameMessageFixtures.navigate);

		expect(seen).toHaveLength(1);
		expect(assign).not.toHaveBeenCalled();
	});

	it("lands a completed order where the server says, not where the caller does", () => {
		// The same `successUrl` must mean the same page on both paths. Only its
		// ORIGIN is ever a destination: the platform builds
		// `<origin>/success/<orderNumber>?hash=…&t=…` — the URL that carries the
		// order proof — and that is what arrives on `complete`. Preferring the
		// caller's value here would make `<qb-checkout>` land somewhere
		// `<qb-checkout-button>` never does.
		const { send } = mountBridge({ successUrl: "https://shop.test/thanks" });
		send(embedFrameMessageFixtures.complete);
		expect(assign).toHaveBeenCalledWith(
			embedFrameMessageFixtures.complete.successUrl,
		);
	});

	it("uses the caller's successUrl only when the server sent none", () => {
		// Which by the server's contract means a stale-order revisit, not a first
		// landing — the caller's page is the only place left to go.
		const { send } = mountBridge({ successUrl: "https://shop.test/thanks" });
		send({ ...embedFrameMessageFixtures.complete, successUrl: null });
		expect(assign).toHaveBeenCalledWith("https://shop.test/thanks");
	});

	it("stays put when neither side has a URL", () => {
		const { send } = mountBridge({ successUrl: null });
		send({ ...embedFrameMessageFixtures.complete, successUrl: null });
		expect(assign).not.toHaveBeenCalled();
	});

	it("stays put on complete when the confirmation is inline", () => {
		const { handle, send } = mountBridge({ confirmation: "inline" });
		const seen: unknown[] = [];
		handle.on("complete", (detail) => seen.push(detail));
		send(embedFrameMessageFixtures.complete);

		expect(seen).toHaveLength(1);
		expect(assign).not.toHaveBeenCalled();
	});
});

describe("a POST redirect", () => {
	let submit: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		submit = vi
			.spyOn(HTMLFormElement.prototype, "submit")
			.mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function form(): HTMLFormElement {
		const found = document.querySelector("form");
		if (!found) throw new Error("no form was built");
		return found;
	}

	it("submits a hidden form to the top window", () => {
		const { send } = mountBridge();
		send(embedFrameMessageFixtures.redirectPost);

		expect(submit).toHaveBeenCalledTimes(1);
		expect(form().getAttribute("method")?.toLowerCase()).toBe("post");
		expect(form().target).toBe("_top");
		expect(form().getAttribute("action")).toBe(
			embedFrameMessageFixtures.redirectPost.url,
		);
		expect(form().style.display).toBe("none");
	});

	it("carries every field as a hidden input", () => {
		const { send } = mountBridge();
		send(embedFrameMessageFixtures.redirectPost);

		const fields = Object.fromEntries(
			Array.from(form().querySelectorAll("input")).map((input) => [
				input.name,
				input.value,
			]),
		);
		expect(fields).toEqual(embedFrameMessageFixtures.redirectPost.data);
		for (const input of form().querySelectorAll("input")) {
			expect(input.type).toBe("hidden");
		}
	});

	it("cannot be made to inject markup into the host page", () => {
		// The values come from a PSP, through a frame. Built with
		// `createElement` + `.value =`, this is inert; built by concatenating
		// HTML it would be a script tag in the merchant's own document.
		const scriptsBefore = document.querySelectorAll("script").length;
		const { send } = mountBridge();
		send({
			...embedFrameMessageFixtures.redirectPost,
			data: {
				'"><script>window.__pwned=1</script>': "x",
				MD: '"><img src=x onerror="window.__pwned=1">',
			},
		});

		expect(document.querySelectorAll("script")).toHaveLength(scriptsBefore);
		expect(document.querySelectorAll("img")).toHaveLength(0);
		const md = form().querySelector<HTMLInputElement>('input[name="MD"]');
		expect(md?.value).toBe('"><img src=x onerror="window.__pwned=1">');
		expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
	});

	it("takes the form back out again on destroy", () => {
		const { handle, send } = mountBridge();
		send(embedFrameMessageFixtures.redirectPost);
		expect(document.querySelectorAll("form")).toHaveLength(1);

		handle.destroy();
		expect(document.querySelectorAll("form")).toHaveLength(0);
	});
});

describe("events", () => {
	it("reports every frame message to its listeners", () => {
		const { handle, send } = mountBridge({ handleNavigation: false });
		const seen: string[] = [];
		for (const type of [
			"ready",
			"height",
			"scroll-to",
			"navigate",
			"redirect",
			"complete",
			"demo-complete",
			"error",
			"event",
			"step",
		] as const) {
			handle.on(type, () => seen.push(type));
		}

		for (const fixture of Object.values(embedFrameMessageFixtures))
			send(fixture);

		expect(seen).toEqual([
			"ready",
			"height",
			"scroll-to",
			"navigate",
			"redirect",
			"redirect",
			"complete",
			"demo-complete",
			"error",
			"event",
			"step",
		]);
	});

	it("forwards a commerce event verbatim, for the page's own dataLayer", () => {
		const { handle, send } = mountBridge();
		const seen: unknown[] = [];
		handle.on("event", (detail) => seen.push(detail));
		send(embedFrameMessageFixtures.event);

		expect(seen[0]).toEqual({
			name: "add_shipping_info",
			params: embedFrameMessageFixtures.event.params,
		});
	});

	it("unsubscribes through the returned function and through off()", () => {
		const { handle, send } = mountBridge();
		const first = vi.fn();
		const second = vi.fn();
		const dispose = handle.on("step", first);
		handle.on("step", second);

		dispose();
		handle.off("step", second);
		send(embedFrameMessageFixtures.step);

		expect(first).not.toHaveBeenCalled();
		expect(second).not.toHaveBeenCalled();
	});

	it("lets a throwing listener neither stop the others nor the navigation", () => {
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { handle, send } = mountBridge();
		const second = vi.fn();
		handle.on("navigate", () => {
			throw new Error("merchant analytics exploded");
		});
		handle.on("navigate", second);

		send(embedFrameMessageFixtures.navigate);

		expect(second).toHaveBeenCalledTimes(1);
		expect(assign).toHaveBeenCalledWith("https://shop.example.com/cart");
		vi.restoreAllMocks();
	});
});

describe("scroll-to", () => {
	it("rebases the frame-relative offset onto the host document", () => {
		const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
		const { iframe, send } = mountBridge();
		vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
			top: 150,
		} as DOMRect);
		Object.defineProperty(window, "scrollY", {
			value: 400,
			configurable: true,
		});

		send(embedFrameMessageFixtures["scroll-to"]);

		expect(scrollTo).toHaveBeenCalledWith({
			top: 150 + 400 + 320,
			behavior: "smooth",
		});
		vi.restoreAllMocks();
	});
});

describe("viewport", () => {
	it("is sent on host scroll, once the frame is ready", async () => {
		const { send, posted } = mountBridge();
		send(READY);
		window.dispatchEvent(new Event("scroll"));
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(posted().at(-1)).toMatchObject({ type: "viewport" });
	});

	it("is not sent before the frame is ready", async () => {
		const { posted } = mountBridge();
		window.dispatchEvent(new Event("scroll"));
		window.dispatchEvent(new Event("resize"));
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(posted()).toHaveLength(0);
	});
});

describe("cart-updated", () => {
	it("tells a ready frame that the page changed the cart", () => {
		const { handle, send, posted } = mountBridge();
		send(READY);
		handle.cartUpdated();

		expect(posted().at(-1)).toEqual({
			source: "qb-checkout-embed",
			v: 1,
			type: "cart-updated",
		});
	});

	it("holds one before the frame is ready, and sends it on the handshake", () => {
		// The frame does NOT re-read the cart as it boots: it shows the snapshot
		// the session was created from, and this message is the only thing that
		// refreshes it. So a change made while it was loading is not "already in
		// what it will show" — dropping it charges the shopper for the cart they
		// just changed. Nobody is listening yet, so it waits for `ready`.
		const { handle, send, posted } = mountBridge();
		handle.cartUpdated();
		expect(posted()).toHaveLength(0);

		send(READY);

		// The `init` the handshake answers with, then the held message.
		expect(posted().at(-1)).toEqual({
			source: "qb-checkout-embed",
			v: 1,
			type: "cart-updated",
		});
		expect(posted()).toHaveLength(2);
	});

	it("holds at most one, whatever the page did while it waited", () => {
		// The message carries nothing — it says only "look again" — so a burst
		// of mutations during the load is one thing to say, not five.
		const { handle, send, posted } = mountBridge();
		handle.cartUpdated();
		handle.cartUpdated();
		handle.cartUpdated();

		send(READY);

		expect(posted()).toHaveLength(2);
	});

	it("has nothing held after the handshake has flushed it", () => {
		const { handle, send, posted } = mountBridge();
		handle.cartUpdated();
		send(READY);
		expect(posted()).toHaveLength(2);

		// A frame that reloads says `ready` again; the message it already got
		// must not arrive a second time.
		send(READY);

		expect(posted()).toHaveLength(3);
		expect(posted().at(-1)).toMatchObject({ type: "init" });
	});

	it("says nothing once the handle is destroyed", () => {
		const { handle, send, posted } = mountBridge();
		send(READY);
		// The `init` the handshake answered with; nothing may follow it.
		expect(posted()).toHaveLength(1);
		handle.destroy();
		handle.cartUpdated();

		expect(posted()).toHaveLength(1);
	});

	it("is a no-op on a fallback handle, which has no frame", () => {
		const handle = new EmbeddedCheckout({
			mode: "fallback",
			reason: "legacy",
			url: null,
			sessionId: null,
			redirect: false,
		});
		live.push(handle);

		expect(() => handle.cartUpdated()).not.toThrow();
	});
});

describe("destroy", () => {
	it("removes the frame, the listeners and the pending handshake", async () => {
		const assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
		const { handle, container, iframe, send, posted } = mountBridge({
			handshakeTimeoutMs: 10,
		});
		const fallbacks = vi.fn();
		handle.on("fallback", fallbacks);

		handle.destroy();

		expect(container.querySelector("iframe")).toBeNull();
		expect(iframe.isConnected).toBe(false);

		send(READY);
		send(embedFrameMessageFixtures.navigate);
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(posted()).toHaveLength(0);
		expect(assign).not.toHaveBeenCalled();
		// The handshake timer went with the frame: no fallback, no redirect.
		expect(fallbacks).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("is idempotent", () => {
		const { handle } = mountBridge();
		handle.destroy();
		expect(() => handle.destroy()).not.toThrow();
	});

	it("stops a viewport frame that was already scheduled", async () => {
		const { handle, send, posted } = mountBridge();
		send(READY);
		window.dispatchEvent(new Event("scroll"));
		handle.destroy();
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(posted()).toHaveLength(1);
	});
});

describe("a fallback handle", () => {
	let assign: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		assign = vi.fn();
		vi.spyOn(window.location, "assign").mockImplementation(
			assign as unknown as (url: string | URL) => void,
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it("emits after the caller has had a chance to listen, then redirects", async () => {
		const handle = new EmbeddedCheckout({
			mode: "fallback",
			reason: "legacy",
			url: "https://checkout.test/checkout/42/sess-1",
			sessionId: "sess-1",
			redirect: true,
		});
		const seen: unknown[] = [];
		handle.on("fallback", (detail) => seen.push(detail));

		expect(handle.state).toBe("fallback");
		expect(handle.iframe).toBeNull();
		expect(seen).toEqual([]);

		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(seen).toEqual([
			{ reason: "legacy", url: "https://checkout.test/checkout/42/sess-1" },
		]);
		expect(assign).toHaveBeenCalledWith(
			"https://checkout.test/checkout/42/sess-1",
		);
	});

	it("does not redirect when the caller opted out", async () => {
		const handle = new EmbeddedCheckout({
			mode: "fallback",
			reason: "no-embed-url",
			url: "https://checkout.test/checkout/42/sess-1",
			sessionId: "sess-1",
			redirect: false,
		});
		const seen = vi.fn();
		handle.on("fallback", seen);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(seen).toHaveBeenCalledTimes(1);
		expect(assign).not.toHaveBeenCalled();
	});

	it("is silent once destroyed before its own timer fired", async () => {
		const handle = new EmbeddedCheckout({
			mode: "fallback",
			reason: "legacy",
			url: "https://checkout.test/checkout/42/sess-1",
			sessionId: null,
			redirect: true,
		});
		const seen = vi.fn();
		handle.on("fallback", seen);
		handle.destroy();
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(seen).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});
});
