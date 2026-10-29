import {
	type EMBED_MESSAGE_SOURCE,
	type EmbedErrorCode,
	type EmbedFrameMessage,
	type EmbedNavigateReason,
	type EmbedRedirectMethod,
	type EmbedStep,
	type EmbedViewport,
	embedCartUpdatedMessage,
	embedFocusMessage,
	embedInitMessage,
	embedViewportMessage,
	isSafeNavigationUrl,
	parseEmbedFrameMessage,
} from "./messages.js";

/** How long to wait for the frame's first `ready` (see `handshake-timeout`). */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/** Initial (and minimum) frame height, before the first `height` message. */
const DEFAULT_MIN_HEIGHT = 600;

/**
 * The live handle per container, so mounting into an element that already
 * shows a checkout replaces it (last mount wins) instead of stacking a second
 * frame. A `WeakMap`, so a removed container takes its entry with it.
 */
const mountedIn = new WeakMap<Element, EmbeddedCheckout>();

/**
 * Error codes an `error` event can carry. All come from the frame; a frame
 * that never answers is reported as a `fallback` instead (see
 * {@link EmbeddedCheckoutFallbackReason}).
 */
export type EmbeddedCheckoutErrorCode = EmbedErrorCode;

/**
 * Why an embed handle is not embedding anything.
 *
 * - `legacy` — the shop runs the legacy checkout, which is not embeddable.
 * - `no-embed-url` — the platform returned no embed URL for a v2 session.
 * - `no-top-navigation` — this page cannot navigate its own top window (it is
 *   itself in a sandboxed frame), so redirect payment methods could not work.
 * - `handshake-timeout` — the frame never said `ready` within 15 seconds and
 *   has been removed. Almost always a `frame-ancestors` refusal: the page is
 *   not the origin the session was created for (a wrong `embedOrigin`, `www`
 *   against the bare domain, a session resumed on another origin), which the
 *   browser reports only inside the frame. A message version mismatch looks
 *   the same.
 */
export type EmbeddedCheckoutFallbackReason =
	| "legacy"
	| "no-embed-url"
	| "no-top-navigation"
	| "handshake-timeout";

export interface EmbeddedCheckoutEventMap {
	ready: { sessionId: string; shopId: string; step: EmbedStep };
	height: { height: number };
	"scroll-to": { top: number };
	navigate: { url: string; reason: EmbedNavigateReason };
	redirect: {
		url: string;
		method: EmbedRedirectMethod;
		data: Record<string, string>;
	};
	complete: {
		sessionId: string;
		orderNumber: number | null;
		successUrl: string | null;
	};
	"demo-complete": { sessionId: string; configureUrl: string | null };
	error: {
		code: EmbeddedCheckoutErrorCode;
		message: string;
		fatal: boolean;
	};
	event: { name: string; params: Record<string, unknown> };
	step: { step: EmbedStep };
	fallback: { reason: EmbeddedCheckoutFallbackReason; url: string | null };
}

export type EmbeddedCheckoutEventType = keyof EmbeddedCheckoutEventMap;

export type EmbeddedCheckoutHandler<T extends EmbeddedCheckoutEventType> = (
	detail: EmbeddedCheckoutEventMap[T],
) => void;

/** Presentation and default-behaviour options, shared by `mount` and `resume`. */
export interface EmbedRenderOptions {
	/**
	 * Height of the frame before the first `height` message, and the floor it
	 * never drops below. Set it to roughly the height of your checkout so the
	 * page does not jump on first paint.
	 */
	minHeight?: number;
	/** The iframe's accessible name. Defaults to `"Checkout"`. */
	title?: string;
	/**
	 * What happens when the order completes.
	 *
	 * - `"redirect"` (default) — leave the page for the confirmed order, at
	 *   exactly the URL the redirect checkout would have sent the shopper to
	 *   (`<successUrl origin>/success/<orderId>?hash=…`), so one thank-you page
	 *   serves both paths.
	 * - `"inline"` — stay on the page and let the frame render its own
	 *   confirmation.
	 */
	confirmation?: "redirect" | "inline";
	/**
	 * Perform the contract's default navigations (`navigate`, `redirect`,
	 * `complete`). Off means the handle only reports; YOU must then perform the
	 * redirect break-out yourself or redirect payment methods will not work.
	 * Defaults to on.
	 */
	handleNavigation?: boolean;
	/**
	 * Navigate to the hosted checkout when there is nothing to frame, or the
	 * frame never answers. On by default, so a shopper is never left with an
	 * empty box. Turn it off to render your own message from the `fallback`
	 * event, whose `url` is where the shopper should go.
	 */
	fallbackRedirect?: boolean;
	/** Override the 15s handshake deadline. For tests, chiefly. */
	handshakeTimeoutMs?: number;
}

export interface EmbeddedCheckoutInitEmbed extends EmbedRenderOptions {
	mode: "embed";
	/** The element the iframe is appended to. */
	container: Element;
	/** The `/embed/{shopId}/{sessionId}` URL. */
	url: string;
	/** Origin of `url`; the only origin messages are accepted from or sent to. */
	checkoutOrigin: string;
	sessionId: string | null;
	/**
	 * Landing page for a completed order, used only when the server sent none
	 * (the server's URL always wins).
	 */
	successUrl?: string | null;
	/**
	 * The hosted checkout URL for the same session, where the shopper is sent
	 * if the frame never answers. With null, the `handshake-timeout` fallback is
	 * reported but nobody is navigated.
	 */
	fallbackUrl: string | null;
}

export interface EmbeddedCheckoutInitFallback {
	mode: "fallback";
	reason: EmbeddedCheckoutFallbackReason;
	/** The hosted (redirect) checkout URL, when there is one. */
	url: string | null;
	sessionId: string | null;
	/** Navigate to `url` after emitting. Off for a caller doing its own thing. */
	redirect: boolean;
}

export type EmbeddedCheckoutInit =
	| EmbeddedCheckoutInitEmbed
	| EmbeddedCheckoutInitFallback;

/**
 * A checkout rendered inside the merchant's own page, and the conversation with
 * it.
 *
 * The iframe is served from the checkout's own origin, so payments work as
 * they do on the redirect path. The frame may not navigate anything: every
 * exit (the back link, a payment redirect, the completed order) arrives as a
 * message and is performed by this host.
 *
 * When there is nothing to embed, or the frame never answers, `state` is
 * `"fallback"` and a `fallback` event carries the hosted checkout URL. This
 * does not throw; one listener covers every route to the hosted checkout.
 */
export class EmbeddedCheckout {
	/** The session being checked out, when one is known. */
	readonly sessionId: string | null;

	private readonly handlers = new Map<string, Set<(detail: never) => void>>();
	private readonly cleanups: Array<() => void> = [];
	private readonly checkoutOrigin: string | null = null;
	private readonly container: Element | null = null;
	private readonly options: EmbedRenderOptions;
	private readonly successUrl: string | null;
	private readonly fallbackUrl: string | null;
	private readonly minHeight: number;
	private currentState: "embed" | "fallback";
	private frame: HTMLIFrameElement | null = null;
	private destroyed = false;
	private ready = false;
	/** A `cartUpdated()` that arrived before the frame could hear it. */
	private pendingCartUpdate = false;
	private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
	private viewportFrame: number | null = null;

	constructor(init: EmbeddedCheckoutInit) {
		this.sessionId = init.sessionId;
		this.options = init.mode === "embed" ? init : {};
		this.successUrl = init.mode === "embed" ? (init.successUrl ?? null) : null;
		this.fallbackUrl = init.mode === "embed" ? init.fallbackUrl : init.url;
		this.minHeight = this.options.minHeight ?? DEFAULT_MIN_HEIGHT;

		if (init.mode === "fallback") {
			this.currentState = "fallback";
			// Deferred so listeners attached after construction hear it.
			const timer = setTimeout(
				() => this.fallBack(init.reason, init.url, init.redirect),
				0,
			);
			this.cleanups.push(() => clearTimeout(timer));
			return;
		}

		this.currentState = "embed";
		this.checkoutOrigin = init.checkoutOrigin;
		this.container = init.container;
		// Last mount wins (see `mountedIn`); the old frame goes first.
		mountedIn.get(init.container)?.destroy();
		mountedIn.set(init.container, this);
		this.frame = this.createFrame(init);
		init.container.append(this.frame);
		this.listen();
		this.watchViewport();
		this.armHandshakeTimeout();
	}

	/**
	 * `"embed"` while framed; `"fallback"` when there was nothing to frame or
	 * the frame never answered and was removed.
	 */
	get state(): "embed" | "fallback" {
		return this.currentState;
	}

	/** The frame, or null in a fallback handle. */
	get iframe(): HTMLIFrameElement | null {
		return this.frame;
	}

	/** Subscribe. Returns an unsubscribe, so a one-liner needs no `off`. */
	on<T extends EmbeddedCheckoutEventType>(
		type: T,
		handler: EmbeddedCheckoutHandler<T>,
	): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler as (detail: never) => void);
		return () => this.off(type, handler);
	}

	off<T extends EmbeddedCheckoutEventType>(
		type: T,
		handler: EmbeddedCheckoutHandler<T>,
	): void {
		this.handlers.get(type)?.delete(handler as (detail: never) => void);
	}

	/** Ask the frame to focus its first control. */
	focus(): void {
		this.post(embedFocusMessage());
	}

	/**
	 * Tell the frame that the cart it is checking out has changed here.
	 *
	 * The session's cart is a snapshot, so a page that lets the shopper edit the
	 * cart while the checkout is shown must call this, or the frame keeps
	 * showing (and charging for) the old cart. The frame re-reads the cart from
	 * the platform, so call this only after the change has been saved.
	 *
	 * `<qb-checkout>` and React's `<Checkout>` call it for you; call it yourself
	 * when you drove `mount()` by hand or changed the cart outside the kit. Safe
	 * to over-call: the frame coalesces bursts. A call before the frame is
	 * `ready` is held and sent then, since the frame does not re-read the cart
	 * while it boots. Ignored by a fallback handle.
	 */
	cartUpdated(): void {
		if (!this.ready) {
			this.pendingCartUpdate = true;
			return;
		}
		this.post(embedCartUpdatedMessage());
	}

	/**
	 * Remove the frame and every listener. Idempotent, and safe to call before
	 * the handshake completes (as React's StrictMode double-mount does).
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.handlers.clear();
		this.frame?.remove();
		if (this.container && mountedIn.get(this.container) === this) {
			mountedIn.delete(this.container);
		}
	}

	/**
	 * Two absences are deliberate:
	 *
	 * - **No `sandbox`.** A sandboxed frame has the opaque origin `"null"`, which
	 *   the message contract rejects, and it blocks nested 3-D Secure iframes.
	 * - **`allow="payment"` is not narrowed**, so enabling wallets inside the
	 *   embed needs no change on merchants' pages.
	 */
	private createFrame(init: EmbeddedCheckoutInitEmbed): HTMLIFrameElement {
		const doc = init.container.ownerDocument ?? document;
		const iframe = doc.createElement("iframe");
		iframe.src = init.url;
		iframe.title = init.title ?? "Checkout";
		iframe.allow = "payment";
		iframe.referrerPolicy = "strict-origin-when-cross-origin";
		iframe.style.width = "100%";
		iframe.style.border = "0";
		iframe.style.height = `${this.minHeight}px`;
		// An inline iframe leaves a baseline gap below it.
		iframe.style.display = "block";
		// The frame paints no background; inline so a merchant's blanket
		// `iframe { background }` rule cannot put an opaque box back.
		iframe.style.background = "transparent";
		return iframe;
	}

	private listen(): void {
		const onMessage = (event: MessageEvent): void => {
			if (!this.accepts(event)) return;
			const message = parseEmbedFrameMessage(event.data);
			if (message) this.handle(message);
		};
		window.addEventListener("message", onMessage);
		this.cleanups.push(() => window.removeEventListener("message", onMessage));
	}

	/**
	 * Both sender checks are needed: the origin check keeps out other
	 * documents, and the `event.source` check keeps out same-origin ones (a
	 * second checkout frame, a popup) that could otherwise drive this handle's
	 * navigation.
	 */
	private accepts(event: MessageEvent): boolean {
		if (this.destroyed) return false;
		if (event.origin !== this.checkoutOrigin) return false;
		const frameWindow = this.frame?.contentWindow ?? null;
		return frameWindow !== null && event.source === frameWindow;
	}

	private handle(message: EmbedFrameMessage): void {
		switch (message.type) {
			case "ready": {
				this.ready = true;
				this.clearHandshakeTimeout();
				// Answered on every ready: a reloaded frame has forgotten what the
				// host told it.
				this.post(embedInitMessage(window.location.href, this.viewport()));
				// A cart change made while the frame was loading; sent after `init`.
				if (this.pendingCartUpdate) {
					this.pendingCartUpdate = false;
					this.post(embedCartUpdatedMessage());
				}
				this.emit("ready", {
					sessionId: message.sessionId,
					shopId: message.shopId,
					step: message.step,
				});
				return;
			}
			case "height": {
				const height = Math.max(Math.round(message.height), this.minHeight);
				if (this.frame) this.frame.style.height = `${height}px`;
				this.emit("height", { height });
				return;
			}
			case "scroll-to": {
				this.scrollTo(message.top);
				this.emit("scroll-to", { top: message.top });
				return;
			}
			case "navigate": {
				this.emit("navigate", { url: message.url, reason: message.reason });
				if (this.handlesNavigation()) window.location.assign(message.url);
				return;
			}
			case "redirect": {
				const data = message.data ?? {};
				this.emit("redirect", {
					url: message.url,
					method: message.method,
					data,
				});
				if (!this.handlesNavigation()) return;
				if (message.method === "POST") this.postForm(message.url, data);
				else window.location.assign(message.url);
				return;
			}
			case "complete": {
				this.emit("complete", {
					sessionId: message.sessionId,
					orderNumber: message.orderNumber,
					successUrl: message.successUrl,
				});
				if (!this.handlesNavigation()) return;
				if (this.options.confirmation === "inline") return;
				// The server's URL wins: it carries the order proof and matches the
				// redirect checkout's landing. The caller's value is only a fallback.
				const target = message.successUrl ?? this.successUrl;
				if (target && isSafeNavigationUrl(target))
					window.location.assign(target);
				return;
			}
			case "demo-complete": {
				this.emit("demo-complete", {
					sessionId: message.sessionId,
					configureUrl: message.configureUrl,
				});
				return;
			}
			case "error": {
				this.emit("error", {
					code: message.code,
					message: message.message,
					fatal: message.fatal,
				});
				return;
			}
			case "event": {
				this.emit("event", { name: message.name, params: message.params });
				return;
			}
			case "step": {
				this.emit("step", { step: message.step });
				return;
			}
		}
	}

	private handlesNavigation(): boolean {
		return this.options.handleNavigation !== false;
	}

	/**
	 * Scroll the host so a point inside the frame comes into view. `top` is
	 * relative to the frame, so it is rebased onto the host document; inside an
	 * auto-sized iframe the frame cannot scroll itself.
	 */
	private scrollTo(top: number): void {
		const rect = this.frame?.getBoundingClientRect();
		if (!rect) return;
		window.scrollTo({
			top: Math.max(rect.top + window.scrollY + top, 0),
			behavior: "smooth",
		});
	}

	/**
	 * A hidden form targeting `_top`: the only way to give a payment provider a
	 * POST from a cross-origin child. Fields are set with `.value`, never built
	 * as HTML, because the values come through the frame and could otherwise
	 * inject markup into the merchant's page.
	 */
	private postForm(url: string, data: Record<string, string>): void {
		const doc = this.frame?.ownerDocument ?? document;
		const form = doc.createElement("form");
		form.method = "POST";
		form.action = url;
		form.target = "_top";
		form.style.display = "none";
		for (const [name, value] of Object.entries(data)) {
			const input = doc.createElement("input");
			input.type = "hidden";
			input.name = name;
			input.value = value;
			form.append(input);
		}
		doc.body.append(form);
		// Removed on destroy, not right after `submit()`, so the submission is
		// never at risk; via the parent so an already-detached form is a no-op.
		this.cleanups.push(() => form.parentNode?.removeChild(form));
		form.submit();
	}

	private viewport(): EmbedViewport {
		const rect = this.frame?.getBoundingClientRect();
		return {
			width: window.innerWidth,
			height: window.innerHeight,
			scrollY: window.scrollY,
			frameTop: rect ? rect.top : 0,
		};
	}

	/**
	 * Report the host's visible region on scroll and resize, throttled to one
	 * animation frame. Passive listeners, so scrolling is never blocked.
	 */
	private watchViewport(): void {
		const send = (): void => {
			this.viewportFrame = null;
			if (this.destroyed || !this.ready) return;
			this.post(embedViewportMessage(this.viewport()));
		};
		const schedule = (): void => {
			if (this.viewportFrame !== null) return;
			this.viewportFrame =
				typeof requestAnimationFrame === "function"
					? requestAnimationFrame(send)
					: (setTimeout(send, 16) as unknown as number);
		};

		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule, { passive: true });
		this.cleanups.push(() => {
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			if (this.viewportFrame === null) return;
			if (typeof cancelAnimationFrame === "function") {
				cancelAnimationFrame(this.viewportFrame);
			} else {
				clearTimeout(
					this.viewportFrame as unknown as ReturnType<typeof setTimeout>,
				);
			}
			this.viewportFrame = null;
		});
	}

	/**
	 * A frame that never says `ready` is removed and reported as a `fallback`,
	 * not an `error`: to the shopper the checkout still opens, just not inline.
	 */
	private armHandshakeTimeout(): void {
		const timeout = this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
		this.handshakeTimer = setTimeout(() => {
			this.handshakeTimer = null;
			if (this.destroyed || this.ready) return;
			const redirect = this.options.fallbackRedirect !== false;
			console.warn(
				"shopkit: the Quickbutik checkout did not answer within " +
					`${Math.round(timeout / 1000)}s. Either it refused to be framed by ` +
					"this page (the session was created for a different origin — an " +
					"`embedOrigin` override, www against the bare domain, a session " +
					"resumed on another origin), or it speaks a message version this " +
					"version of the kit does not. " +
					(redirect && this.fallbackUrl
						? "The shopper is being sent to the hosted checkout instead."
						: "The frame has been removed; `fallback` carries the hosted URL."),
			);
			this.dropFrame();
			this.fallBack("handshake-timeout", this.fallbackUrl, redirect);
		}, timeout);
		this.cleanups.push(() => this.clearHandshakeTimeout());
	}

	/**
	 * Remove the frame and its listeners but keep the handle's subscribers, so
	 * they still hear `fallback` (unlike `destroy()`).
	 */
	private dropFrame(): void {
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.frame?.remove();
		this.frame = null;
		this.currentState = "fallback";
	}

	/** Report the hosted checkout as the destination, then go there. */
	private fallBack(
		reason: EmbeddedCheckoutFallbackReason,
		url: string | null,
		redirect: boolean,
	): void {
		this.emit("fallback", { reason, url });
		if (redirect && url && isSafeNavigationUrl(url)) {
			window.location.assign(url);
		}
	}

	private clearHandshakeTimeout(): void {
		if (this.handshakeTimer === null) return;
		clearTimeout(this.handshakeTimer);
		this.handshakeTimer = null;
	}

	/** Always an explicit target origin, never `"*"` — we built the `src`. */
	private post(message: { source: typeof EMBED_MESSAGE_SOURCE }): void {
		if (this.destroyed || !this.checkoutOrigin) return;
		this.frame?.contentWindow?.postMessage(message, this.checkoutOrigin);
	}

	private emit<T extends EmbeddedCheckoutEventType>(
		type: T,
		detail: EmbeddedCheckoutEventMap[T],
	): void {
		const set = this.handlers.get(type);
		if (!set) return;
		for (const handler of [...set]) {
			try {
				(handler as EmbeddedCheckoutHandler<T>)(detail);
			} catch (error) {
				// A throwing listener must not stop the others or the default
				// navigation that follows.
				console.error(`shopkit: a qb:checkout-${type} listener threw`, error);
			}
		}
	}
}
