/** Minimal cookie primitives, usable in the browser and on the server. */

export interface CookieAttributes {
	/** Defaults to `/` so the id is visible to every route of the storefront. */
	path?: string;
	/** Seconds. Omitted → session cookie. */
	maxAge?: number;
	domain?: string;
	/** Defaults to true on https origins, false otherwise (so localhost works). */
	secure?: boolean;
	/** Defaults to `lax`, which (unlike `strict`) survives the return from the hosted checkout. */
	sameSite?: "lax" | "strict" | "none";
	/** Only meaningful on the server; the browser cannot set httpOnly cookies. */
	httpOnly?: boolean;
}

/** Parse a `Cookie:` header (or `document.cookie`) into a plain record. */
export function parseCookieHeader(
	header: string | null | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 1) continue;
		const name = part.slice(0, eq).trim();
		if (!name) continue;
		const raw = part.slice(eq + 1).trim();
		try {
			out[name] = decodeURIComponent(raw);
		} catch {
			// Keep a malformed escape verbatim rather than dropping the header.
			out[name] = raw;
		}
	}
	return out;
}

/** Serialize one cookie into a `Set-Cookie` value. */
export function serializeCookie(
	name: string,
	value: string,
	attributes: CookieAttributes = {},
): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	parts.push(`Path=${attributes.path ?? "/"}`);
	if (typeof attributes.maxAge === "number") {
		// Floor: a fractional Max-Age is invalid and some clients drop the cookie.
		parts.push(`Max-Age=${Math.floor(attributes.maxAge)}`);
	}
	if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
	parts.push(`SameSite=${capitalize(attributes.sameSite ?? "lax")}`);
	if (attributes.secure ?? isSecureOrigin()) parts.push("Secure");
	if (attributes.httpOnly) parts.push("HttpOnly");
	return parts.join("; ");
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Whether the browser origin is https. False on the server; pass `secure` there. */
function isSecureOrigin(): boolean {
	if (typeof location === "undefined") return false;
	return location.protocol === "https:";
}

/** Read one cookie from `document.cookie`. Returns null outside a browser. */
export function readDocumentCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const parsed = parseCookieHeader(document.cookie);
	return parsed[name] ?? null;
}

/** Write one cookie to `document.cookie`. No-op outside a browser. */
export function writeDocumentCookie(
	name: string,
	value: string,
	attributes?: CookieAttributes,
): void {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: writing document.cookie IS this function; the CookieStore API is not available in every target runtime.
	document.cookie = serializeCookie(name, value, attributes);
}

/** Expire one cookie in `document.cookie`. No-op outside a browser. */
export function deleteDocumentCookie(
	name: string,
	attributes?: CookieAttributes,
): void {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: see writeDocumentCookie.
	document.cookie = serializeCookie(name, "", { ...attributes, maxAge: 0 });
}
