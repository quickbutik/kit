import {
	deleteDocumentCookie,
	parseCookieHeader,
	writeDocumentCookie,
} from "../runtime/cookies.js";
import type { ConsentState } from "./types.js";

/**
 * The decision cookie's default name. A cookie rather than localStorage so a
 * server can read it and render the right banner state on the first byte.
 */
export const DEFAULT_CONSENT_COOKIE = "qb_consent";

/** Six months, within the re-collection window most EU regulators consider reasonable. */
export const DEFAULT_CONSENT_MAX_AGE_DAYS = 180;

export const DEFAULT_CONSENT_REVISION = 1;

export interface ConsentCookieOptions {
	/** Defaults to `qb_consent`. */
	cookieName?: string;
	/** The revision a stored decision must match to count. Defaults to 1. */
	revision?: number;
}

export interface ConsentCookieWriteOptions extends ConsentCookieOptions {
	/** Defaults to 180 days. */
	maxAgeDays?: number;
	/** Share the decision across subdomains (`.myshop.com`). Host-only by default. */
	domain?: string;
	/** Defaults to `lax`. */
	sameSite?: "lax" | "strict" | "none";
	/** Defaults to true on https origins, false otherwise (localhost works). */
	secure?: boolean;
}

/** The stored shape. Short keys on purpose: this travels on every request. */
interface StoredConsent {
	rev: number;
	analytics: boolean;
	marketing: boolean;
	decidedAt: string;
}

/** The state before any decision — and after a revision bump or a reset. */
export function undecidedConsent(
	revision: number = DEFAULT_CONSENT_REVISION,
): ConsentState {
	return {
		status: "undecided",
		analytics: false,
		marketing: false,
		decidedAt: null,
		revision,
	};
}

/**
 * Decode one cookie value. Anything that is not a well-formed decision for
 * the expected revision reads as undecided.
 */
export function parseConsentCookieValue(
	raw: string | null | undefined,
	revision: number = DEFAULT_CONSENT_REVISION,
): ConsentState {
	if (!raw) return undecidedConsent(revision);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undecidedConsent(revision);
	}
	if (!isStoredConsent(parsed) || parsed.rev !== revision) {
		return undecidedConsent(revision);
	}
	return {
		status: "decided",
		analytics: parsed.analytics,
		marketing: parsed.marketing,
		decidedAt: parsed.decidedAt,
		revision,
	};
}

/**
 * Read the decision from a `Cookie:` header (or `document.cookie`). The
 * server-side entry point: `readConsentCookie(request.headers.get("cookie"))`
 * in a route handler, `readConsentCookie(cookies().toString())` in Next.
 */
export function readConsentCookie(
	cookieHeader: string | null | undefined,
	options: ConsentCookieOptions = {},
): ConsentState {
	const cookies = parseCookieHeader(cookieHeader);
	return parseConsentCookieValue(
		cookies[options.cookieName ?? DEFAULT_CONSENT_COOKIE],
		options.revision ?? DEFAULT_CONSENT_REVISION,
	);
}

/**
 * The cookie value for a decided state. Throws on an undecided one: there is
 * nothing to store, and `clearConsentCookie` is how "undecided" is written.
 */
export function serializeConsentState(state: ConsentState): string {
	if (state.status !== "decided") {
		throw new Error(
			"shopkit: only a decided consent state can be serialized; clear the cookie instead.",
		);
	}
	const stored: StoredConsent = {
		rev: state.revision,
		analytics: state.analytics,
		marketing: state.marketing,
		decidedAt: state.decidedAt ?? new Date().toISOString(),
	};
	return JSON.stringify(stored);
}

/** Write the decision to `document.cookie`. No-op outside a browser. */
export function writeConsentCookie(
	state: ConsentState,
	options: ConsentCookieWriteOptions = {},
): void {
	writeDocumentCookie(
		options.cookieName ?? DEFAULT_CONSENT_COOKIE,
		serializeConsentState(state),
		{
			maxAge: (options.maxAgeDays ?? DEFAULT_CONSENT_MAX_AGE_DAYS) * 86_400,
			domain: options.domain,
			sameSite: options.sameSite,
			secure: options.secure,
		},
	);
}

/** Expire the decision cookie. No-op outside a browser. */
export function clearConsentCookie(
	options: ConsentCookieWriteOptions = {},
): void {
	deleteDocumentCookie(options.cookieName ?? DEFAULT_CONSENT_COOKIE, {
		domain: options.domain,
		sameSite: options.sameSite,
		secure: options.secure,
	});
}

function isStoredConsent(value: unknown): value is StoredConsent {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.rev === "number" &&
		typeof candidate.analytics === "boolean" &&
		typeof candidate.marketing === "boolean" &&
		typeof candidate.decidedAt === "string"
	);
}
