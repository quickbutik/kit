import { describe, expect, it } from "vitest";
import {
	EMBED_MESSAGE_SOURCE,
	EMBED_MESSAGE_VERSION,
	embedCartUpdatedMessage,
	embedFocusMessage,
	embedInitMessage,
	embedViewportMessage,
	isSafeNavigationUrl,
	parseEmbedFrameMessage,
} from "../src/sdk/embed/messages.js";
import {
	embedFrameMessageFixtures,
	embedHostMessageFixtures,
	embedRejectedFixtures,
} from "./fixtures/embed-messages.fixtures.js";

/** A mutable deep copy — the fixtures are frozen `as const` literals. */
function copy<T>(value: T): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

const FRAME_FIXTURES = Object.entries(embedFrameMessageFixtures);

describe("the shared fixtures", () => {
	it("carries the envelope this build implements", () => {
		for (const [name, fixture] of FRAME_FIXTURES) {
			expect(fixture.source, name).toBe(EMBED_MESSAGE_SOURCE);
			expect(fixture.v, name).toBe(EMBED_MESSAGE_VERSION);
		}
		for (const fixture of Object.values(embedHostMessageFixtures)) {
			expect(fixture.source).toBe(EMBED_MESSAGE_SOURCE);
			expect(fixture.v).toBe(EMBED_MESSAGE_VERSION);
		}
	});

	it("is accepted, message for message", () => {
		for (const [name, fixture] of FRAME_FIXTURES) {
			const parsed = parseEmbedFrameMessage(copy(fixture));
			expect(parsed, `${name} should parse`).not.toBeNull();
			expect(parsed?.type, name).toBe(fixture.type);
		}
	});

	/**
	 * The half of the contract that matters. A parser that accepts every
	 * message above and also accepts a `javascript:` redirect has passed the
	 * easy half: that URL reaches `location.assign` on the MERCHANT's origin.
	 *
	 * Table-driven and keyed by what is wrong with each envelope, so a
	 * regression names the hole rather than pointing at a loop. The frame side
	 * asserts the same map from its own copy of this file.
	 */
	it.each(
		Object.entries(embedRejectedFixtures),
	)("rejects %s", (_name, fixture) => {
		expect(parseEmbedFrameMessage(fixture)).toBeNull();
	});

	it("survives the structured clone a real postMessage performs", () => {
		for (const [name, fixture] of FRAME_FIXTURES) {
			const cloned = structuredClone(copy(fixture));
			expect(parseEmbedFrameMessage(cloned), name).not.toBeNull();
		}
	});
});

describe("parseEmbedFrameMessage", () => {
	it("drops anything that is not ours", () => {
		expect(parseEmbedFrameMessage(null)).toBeNull();
		expect(parseEmbedFrameMessage("ready")).toBeNull();
		expect(parseEmbedFrameMessage(42)).toBeNull();
		expect(parseEmbedFrameMessage({})).toBeNull();
		// The admin preview's envelope: a sibling contract on the same page, and
		// a message meant for one must never be readable as one for the other.
		expect(
			parseEmbedFrameMessage({ source: "qb-checkout-preview", type: "ready" }),
		).toBeNull();
	});

	it("drops every fixture with a foreign source", () => {
		for (const [name, fixture] of FRAME_FIXTURES) {
			const mutated = copy(fixture);
			mutated.source = "qb-checkout-preview";
			expect(parseEmbedFrameMessage(mutated), name).toBeNull();
		}
	});

	it("drops every fixture from a version it does not implement", () => {
		for (const [name, fixture] of FRAME_FIXTURES) {
			for (const v of [2, "1", 0, null, undefined]) {
				const mutated = copy(fixture);
				mutated.v = v;
				expect(parseEmbedFrameMessage(mutated), `${name} v=${v}`).toBeNull();
			}
		}
	});

	it("drops an unknown type", () => {
		const mutated = copy(embedFrameMessageFixtures.ready);
		mutated.type = "pay";
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	/**
	 * `error` is deliberately absent from this table: every one of its fields
	 * falls back (an unknown code becomes `unknown`, a missing message becomes
	 * empty), because dropping the message that says the checkout broke is the
	 * one failure the host could never report.
	 */
	const REQUIRED: Array<[keyof typeof embedFrameMessageFixtures, string]> = [
		["ready", "sessionId"],
		["ready", "shopId"],
		["height", "height"],
		["scroll-to", "top"],
		["navigate", "url"],
		["navigate", "reason"],
		["redirectGet", "url"],
		["redirectGet", "method"],
		["redirectPost", "url"],
		["complete", "sessionId"],
		["demo-complete", "sessionId"],
		["event", "name"],
		["step", "step"],
	];

	it.each(REQUIRED)("drops %s with no %s", (name, field) => {
		const mutated = copy(embedFrameMessageFixtures[name]);
		delete mutated[field];
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	it.each([
		"navigate",
		"redirectGet",
		"redirectPost",
	] as const)("drops %s carrying a javascript: url", (name) => {
		for (const url of [
			"javascript:alert(document.cookie)",
			"data:text/html,<script>fetch('//evil')</script>",
			"file:///etc/passwd",
			"/relative/path",
			"http://evil.example.com/pay",
		]) {
			const mutated = copy(embedFrameMessageFixtures[name]);
			mutated.url = url;
			expect(parseEmbedFrameMessage(mutated), url).toBeNull();
		}
	});

	it("drops a complete whose successUrl could not be navigated to", () => {
		// A URL the host acts on must hold up or the message goes: `complete`
		// navigates to this one by default.
		const mutated = copy(embedFrameMessageFixtures.complete);
		mutated.successUrl = "javascript:alert(1)";
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	it("keeps a complete that simply has no successUrl", () => {
		// Absent means the server had none, which is ordinary.
		const mutated = copy(embedFrameMessageFixtures.complete);
		mutated.successUrl = null;
		expect(parseEmbedFrameMessage(mutated)).toMatchObject({
			type: "complete",
			successUrl: null,
			orderNumber: 100244,
		});
	});

	it("nulls an unusable demo configureUrl instead, since nothing navigates to it", () => {
		const mutated = copy(embedFrameMessageFixtures["demo-complete"]);
		mutated.configureUrl = "javascript:alert(1)";
		expect(parseEmbedFrameMessage(mutated)).toMatchObject({
			type: "demo-complete",
			configureUrl: null,
		});
	});

	it("keeps a redirect's POST fields and drops the non-string ones", () => {
		const mutated = copy(embedFrameMessageFixtures.redirectPost);
		mutated.data = { MD: "abc", PaReq: 12, nested: { a: 1 }, TermUrl: null };
		expect(parseEmbedFrameMessage(mutated)).toMatchObject({
			data: { MD: "abc" },
		});
	});

	it("gives a redirect with no data an empty map, not undefined", () => {
		const parsed = parseEmbedFrameMessage(
			copy(embedFrameMessageFixtures.redirectGet),
		);
		expect(parsed).toMatchObject({ method: "GET", data: {} });
	});

	it("drops a ready whose step this build does not know", () => {
		// Not repaired to `contact`: a checkout that has grown a step this build
		// has never heard of is one it cannot follow, and the honest outcome is
		// the handshake timeout — the same as an unimplemented envelope version.
		const mutated = copy(embedFrameMessageFixtures.ready);
		mutated.step = "upsell";
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	it("rejects an unknown step on a step message too", () => {
		const mutated = copy(embedFrameMessageFixtures.step);
		mutated.step = "upsell";
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	it("normalizes an unknown error code to `unknown`", () => {
		const mutated = copy(embedFrameMessageFixtures.error);
		mutated.code = "meteor";
		delete mutated.message;
		delete mutated.fatal;
		expect(parseEmbedFrameMessage(mutated)).toMatchObject({
			code: "unknown",
			message: "",
			fatal: false,
		});
	});

	it("rejects a height that is not a usable number", () => {
		for (const height of [Number.NaN, Number.POSITIVE_INFINITY, "600", -1]) {
			const mutated = copy(embedFrameMessageFixtures.height);
			mutated.height = height;
			expect(parseEmbedFrameMessage(mutated), String(height)).toBeNull();
		}
	});

	it("rejects a redirect method that is neither GET nor POST", () => {
		const mutated = copy(embedFrameMessageFixtures.redirectGet);
		mutated.method = "get";
		expect(parseEmbedFrameMessage(mutated)).toBeNull();
	});

	it("never returns the sender's own envelope fields", () => {
		const mutated = copy(embedFrameMessageFixtures.height);
		mutated.__proto__ = { polluted: true };
		mutated.extra = "ignored";
		expect(parseEmbedFrameMessage(mutated)).toEqual({
			source: EMBED_MESSAGE_SOURCE,
			v: EMBED_MESSAGE_VERSION,
			type: "height",
			height: 1284,
		});
	});
});

describe("isSafeNavigationUrl", () => {
	// The loopback set is a PORT of the frame's `isLoopbackHostname`, not an
	// equivalent of it. A host that is stricter than the frame drops a message
	// the frame was happy to send, and a dropped message makes no sound — which
	// is why `app.localhost` and a range-checked 127/8 are asserted here by
	// name. See the comment on `isSafeNavigationUrl`.
	it.each([
		"https://shop.example.com/cart",
		"https://checkoutshopper-test.adyen.com/pay?x=1",
		"http://localhost:3000/cart",
		// Subdomain routing on a dev server: browsers resolve it to loopback.
		"http://app.localhost:5173/checkout",
		"http://shop.app.localhost:5173/",
		"http://127.0.0.1:5173/",
		"http://127.255.255.255/",
		"http://[::1]:8080/x",
	])("accepts %s", (url) => {
		expect(isSafeNavigationUrl(url)).toBe(true);
	});

	it("accepts a shorthand IPv4 the URL parser expands into 127/8", () => {
		// `new URL` normalizes `127.0.0` to `127.0.0.0`, so the range check sees a
		// real loopback address. Asserted because it is the kind of thing two
		// hand-written implementations drift apart on.
		expect(isSafeNavigationUrl("http://127.0.0/")).toBe(true);
	});

	it("accepts the bare IPv6 spellings a hand-written message can carry", () => {
		// `URL.hostname` brackets these, but the frame tolerates both forms and
		// so must this.
		expect(isSafeNavigationUrl("http://[0:0:0:0:0:0:0:1]:8080/x")).toBe(true);
	});

	it.each([
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"data:text/html,<h1>hi</h1>",
		"file:///etc/passwd",
		"about:blank",
		"vbscript:msgbox(1)",
		// Plausible-looking but unusable here: relative URLs are not resolved,
		// because resolving an attacker-chosen path against the merchant's page
		// is more surprising than dropping the message.
		"/cart",
		"//evil.example.com/cart",
		"http://evil.example.com/cart",
		// Not an address at all — every octet is range-checked, so a loose
		// `\d{1,3}` pattern would let this through.
		"http://127.999.999.999/",
		"http://127.0.0.1.evil.com/",
		// The suffix check is anchored on a dot: these are ordinary public hosts.
		"http://notlocalhost.com/",
		"http://localhost.evil.com/",
		"http://mylocalhost/",
		"",
		"   ",
	])("rejects %s", (url) => {
		expect(isSafeNavigationUrl(url)).toBe(false);
	});

	it("rejects anything that is not a string", () => {
		expect(isSafeNavigationUrl(undefined)).toBe(false);
		expect(isSafeNavigationUrl(null)).toBe(false);
		expect(isSafeNavigationUrl(new URL("https://a.test"))).toBe(false);
	});
});

describe("host message builders", () => {
	it("produce exactly the shared fixtures", () => {
		expect(
			embedInitMessage("https://shop.example.com/checkout", {
				width: 1280,
				height: 800,
				scrollY: 240,
				frameTop: -120,
			}),
		).toEqual(embedHostMessageFixtures.init);

		expect(
			embedViewportMessage({
				width: 1280,
				height: 800,
				scrollY: 640,
				frameTop: -520,
			}),
		).toEqual(embedHostMessageFixtures.viewport);

		expect(embedFocusMessage()).toEqual(embedHostMessageFixtures.focus);

		expect(embedCartUpdatedMessage()).toEqual(
			embedHostMessageFixtures["cart-updated"],
		);
	});

	it("covers every host message in the contract", () => {
		// A fixture map that quietly loses an entry turns the table-driven tests
		// into tests of a smaller contract. The frame's copy asserts the same
		// list from its own half of the fixture file.
		expect(Object.keys(embedHostMessageFixtures).sort()).toEqual([
			"cart-updated",
			"focus",
			"init",
			"viewport",
		]);
	});

	it("does not read a host message as a frame message", () => {
		// `cart-updated` travels the other way. A host parser and a frame parser
		// that both accepted it would let a compromised frame tell its own host
		// to do something — the two directions are separate contracts.
		for (const [name, fixture] of Object.entries(embedHostMessageFixtures)) {
			expect(parseEmbedFrameMessage(fixture), name).toBeNull();
		}
	});
});
