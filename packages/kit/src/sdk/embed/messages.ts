/**
 * The host half of the embedded-checkout `postMessage` contract. The frame half
 * lives in the checkout and must stay in step with this one.
 *
 * Validation is hand-written (the package has no runtime dependencies) and
 * never throws: input arrives from another origin, so a malformed message is
 * dropped, and an unknown enum value falls back to a safe default or rejects
 * the whole message.
 */

/**
 * The discriminator: messages without it (from payment providers, browser
 * extensions, devtools) are not ours. Distinct from the admin preview's
 * `qb-checkout-preview`, so a message meant for one is never read as the other.
 */
export const EMBED_MESSAGE_SOURCE = "qb-checkout-embed";

/**
 * The envelope version. Both sides ignore versions they do not implement, so a
 * mismatch degrades to a `handshake-timeout` fallback rather than a misread
 * payload.
 */
export const EMBED_MESSAGE_VERSION = 1;

/** The step the shopper is on inside the checkout. */
export type EmbedStep = "contact" | "payment";

/** Why the frame wants the host to leave the checkout. */
export type EmbedNavigateReason = "back" | "continue-shopping" | "product";

/** How a PSP wants to be handed the shopper. */
export type EmbedRedirectMethod = "GET" | "POST";

/** Error codes the frame can report. */
export type EmbedErrorCode =
	| "invalid-session"
	| "cannot-embed"
	| "gateway-unavailable"
	| "payment-failed"
	| "unknown";

/**
 * The host's visible region, so a modal or 3-D Secure overlay inside a tall
 * auto-sized frame can position itself on screen.
 */
export interface EmbedViewport {
	/** Host viewport size. */
	width: number;
	height: number;
	/** Host scroll offset. */
	scrollY: number;
	/** The iframe's top edge relative to the host viewport. */
	frameTop: number;
}

interface EmbedEnvelope {
	source: typeof EMBED_MESSAGE_SOURCE;
	v: typeof EMBED_MESSAGE_VERSION;
}

// Frame → host

export interface EmbedReadyMessage extends EmbedEnvelope {
	type: "ready";
	sessionId: string;
	shopId: string;
	step: EmbedStep;
}

export interface EmbedHeightMessage extends EmbedEnvelope {
	type: "height";
	height: number;
}

export interface EmbedScrollToMessage extends EmbedEnvelope {
	type: "scroll-to";
	/** Pixels relative to the frame's own top. */
	top: number;
}

export interface EmbedNavigateMessage extends EmbedEnvelope {
	type: "navigate";
	url: string;
	reason: EmbedNavigateReason;
}

export interface EmbedRedirectMessage extends EmbedEnvelope {
	type: "redirect";
	url: string;
	method: EmbedRedirectMethod;
	/** Flat string map for a POST. Non-string values are dropped on parse. */
	data?: Record<string, string>;
}

export interface EmbedCompleteMessage extends EmbedEnvelope {
	type: "complete";
	sessionId: string;
	orderNumber: number | null;
	/** The platform's own success URL, or null when the server had none. */
	successUrl: string | null;
}

export interface EmbedDemoCompleteMessage extends EmbedEnvelope {
	type: "demo-complete";
	sessionId: string;
	configureUrl: string | null;
}

export interface EmbedErrorMessage extends EmbedEnvelope {
	type: "error";
	code: EmbedErrorCode;
	message: string;
	fatal: boolean;
}

export interface EmbedEventMessage extends EmbedEnvelope {
	type: "event";
	/** GA4-shaped: `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`. */
	name: string;
	params: Record<string, unknown>;
}

export interface EmbedStepMessage extends EmbedEnvelope {
	type: "step";
	step: EmbedStep;
}

export type EmbedFrameMessage =
	| EmbedReadyMessage
	| EmbedHeightMessage
	| EmbedScrollToMessage
	| EmbedNavigateMessage
	| EmbedRedirectMessage
	| EmbedCompleteMessage
	| EmbedDemoCompleteMessage
	| EmbedErrorMessage
	| EmbedEventMessage
	| EmbedStepMessage;

// Host → frame

export interface EmbedInitMessage extends EmbedEnvelope {
	type: "init";
	hostUrl: string;
	viewport: EmbedViewport;
}

export interface EmbedViewportMessage extends EmbedEnvelope {
	type: "viewport";
	viewport: EmbedViewport;
}

export interface EmbedFocusMessage extends EmbedEnvelope {
	type: "focus";
}

/**
 * The session's cart has changed on the host page. Payload-free on purpose:
 * the frame re-reads the cart from the platform, so the host page (outside the
 * trust boundary) can never dictate what the shopper is charged.
 */
export interface EmbedCartUpdatedMessage extends EmbedEnvelope {
	type: "cart-updated";
}

export type EmbedHostMessage =
	| EmbedInitMessage
	| EmbedViewportMessage
	| EmbedFocusMessage
	| EmbedCartUpdatedMessage;

const ENVELOPE: EmbedEnvelope = {
	source: EMBED_MESSAGE_SOURCE,
	v: EMBED_MESSAGE_VERSION,
};

export function embedInitMessage(
	hostUrl: string,
	viewport: EmbedViewport,
): EmbedInitMessage {
	return { ...ENVELOPE, type: "init", hostUrl, viewport };
}

export function embedViewportMessage(
	viewport: EmbedViewport,
): EmbedViewportMessage {
	return { ...ENVELOPE, type: "viewport", viewport };
}

export function embedFocusMessage(): EmbedFocusMessage {
	return { ...ENVELOPE, type: "focus" };
}

export function embedCartUpdatedMessage(): EmbedCartUpdatedMessage {
	return { ...ENVELOPE, type: "cart-updated" };
}

// URL safety

/**
 * Whether the host may navigate to this URL.
 *
 * Every contract URL is checked on both sides; this is the host's copy, and it
 * matters most here because the host performs the navigation: a `javascript:`
 * URL passed to `location.assign` would run in the merchant's page.
 *
 * `https:` only, plus `http:` on loopback for local development. Relative URLs
 * are rejected. Must match the frame's check exactly, including which hosts
 * count as loopback: a stricter host silently drops messages the frame sends.
 */
export function isSafeNavigationUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.trim() === "") return false;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

/**
 * `localhost`, anything under it (`app.localhost`), both spellings of IPv6
 * loopback, and 127/8 with every octet range-checked.
 */
function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	// `URL.hostname` brackets an IPv6 literal; the bare form can still arrive
	// from a hand-written message.
	const bare =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	if (bare === "localhost" || bare === "::1" || bare === "0:0:0:0:0:0:0:1") {
		return true;
	}
	if (bare.endsWith(".localhost") && bare.length > ".localhost".length) {
		return true;
	}
	return /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(bare);
}

// Parsing

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** A finite number, or null — `Infinity` and `NaN` are never usable as lengths. */
function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const STEPS: readonly EmbedStep[] = ["contact", "payment"];
const NAVIGATE_REASONS: readonly EmbedNavigateReason[] = [
	"back",
	"continue-shopping",
	"product",
];
const ERROR_CODES: readonly EmbedErrorCode[] = [
	"invalid-session",
	"cannot-embed",
	"gateway-unavailable",
	"payment-failed",
	"unknown",
];

/**
 * The POST body for a redirect, as a flat string map. Non-string values are
 * dropped rather than coerced, since these become form field values verbatim.
 */
function asStringMap(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") out[key] = entry;
	}
	return out;
}

/**
 * Validate a `MessageEvent.data` as a frame message, or return null for
 * anything that is not ours, has an unknown version, or carries an invalid
 * payload. This checks content only; the caller must also check the sender's
 * origin and window.
 */
export function parseEmbedFrameMessage(
	data: unknown,
): EmbedFrameMessage | null {
	if (!isRecord(data)) return null;
	if (data.source !== EMBED_MESSAGE_SOURCE) return null;
	if (data.v !== EMBED_MESSAGE_VERSION) return null;

	switch (data.type) {
		case "ready": {
			const sessionId = asString(data.sessionId);
			const shopId = asString(data.shopId);
			if (sessionId === "" || shopId === "") return null;
			// An unknown step drops the message (surfacing as a handshake timeout)
			// rather than guessing: this build cannot follow that checkout.
			const step = STEPS.find((value) => value === data.step);
			if (!step) return null;
			return { ...ENVELOPE, type: "ready", sessionId, shopId, step };
		}
		case "height": {
			const height = asFiniteNumber(data.height);
			if (height === null || height < 0) return null;
			return { ...ENVELOPE, type: "height", height };
		}
		case "scroll-to": {
			const top = asFiniteNumber(data.top);
			if (top === null) return null;
			return { ...ENVELOPE, type: "scroll-to", top };
		}
		case "navigate": {
			if (!isSafeNavigationUrl(data.url)) return null;
			const reason = NAVIGATE_REASONS.find((value) => value === data.reason);
			if (!reason) return null;
			return { ...ENVELOPE, type: "navigate", url: data.url, reason };
		}
		case "redirect": {
			if (!isSafeNavigationUrl(data.url)) return null;
			if (data.method !== "GET" && data.method !== "POST") return null;
			return {
				...ENVELOPE,
				type: "redirect",
				url: data.url,
				method: data.method,
				data: asStringMap(data.data),
			};
		}
		case "complete": {
			const sessionId = asString(data.sessionId);
			if (sessionId === "") return null;
			// The host navigates to `successUrl`, so an unsafe one drops the whole
			// message. Absent means the server had none.
			const successUrl = data.successUrl ?? null;
			if (successUrl !== null && !isSafeNavigationUrl(successUrl)) return null;
			return {
				...ENVELOPE,
				type: "complete",
				sessionId,
				orderNumber: asFiniteNumber(data.orderNumber),
				successUrl,
			};
		}
		case "demo-complete": {
			const sessionId = asString(data.sessionId);
			if (sessionId === "") return null;
			// Nulled rather than dropped: `configureUrl` is only rendered as a
			// link, never navigated to.
			return {
				...ENVELOPE,
				type: "demo-complete",
				sessionId,
				configureUrl: isSafeNavigationUrl(data.configureUrl)
					? data.configureUrl
					: null,
			};
		}
		case "error": {
			return {
				...ENVELOPE,
				type: "error",
				code: ERROR_CODES.find((code) => code === data.code) ?? "unknown",
				message: asString(data.message),
				fatal: data.fatal === true,
			};
		}
		case "event": {
			const name = asString(data.name);
			if (name === "") return null;
			return {
				...ENVELOPE,
				type: "event",
				name,
				params: isRecord(data.params) ? data.params : {},
			};
		}
		case "step": {
			const step = STEPS.find((value) => value === data.step);
			if (!step) return null;
			return { ...ENVELOPE, type: "step", step };
		}
		default:
			return null;
	}
}
