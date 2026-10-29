import { describe, expect, it } from "vitest";
import { ShopkitConfigError } from "../src/sdk/errors.js";
import { parsePublishableKey, redactKey } from "../src/sdk/key.js";

describe("parsePublishableKey", () => {
	it("extracts the shop's storage prefix from the key", () => {
		const actual = parsePublishableKey("qb_pk_1786519440r_deadbeefcafe");
		expect(actual).toEqual({
			key: "qb_pk_1786519440r_deadbeefcafe",
			shopPrefix: "1786519440r",
		});
	});

	it("keeps the prefix verbatim — it is not the numeric shop id", () => {
		// The platform mints keys with the shop's storage PREFIX (`101928Y`, the
		// CDN folder), not its numeric id (`101928`). Nothing may be stripped or
		// coerced: the prefix is right for image paths and wrong for the hosted
		// checkout URL, and callers must be able to tell which one they hold.
		const actual = parsePublishableKey("qb_pk_101928Y_deadbeefcafe");
		expect(actual.shopPrefix).toBe("101928Y");
		expect(actual).not.toHaveProperty("shopId");
	});

	it("tolerates surrounding whitespace from a copy-paste or an env file", () => {
		expect(parsePublishableKey("  qb_pk_shop1_secret \n").shopPrefix).toBe(
			"shop1",
		);
	});

	it("keeps underscores that belong to the secret portion", () => {
		// Prefixes cannot contain `_`, so everything after the third segment is
		// secret — including further underscores.
		expect(parsePublishableKey("qb_pk_shop1_aaa_bbb").shopPrefix).toBe("shop1");
	});

	it("rejects a personal access token", () => {
		expect(() => parsePublishableKey("qb_pat_shop1_secret")).toThrow(
			ShopkitConfigError,
		);
		expect(() => parsePublishableKey("qb_pat_shop1_secret")).toThrow(/qb_pk_/);
	});

	it("rejects an empty key", () => {
		expect(() => parsePublishableKey("   ")).toThrow(/required/);
	});

	it("rejects a key with no secret portion, naming the expected shape", () => {
		expect(() => parsePublishableKey("qb_pk_shop1")).toThrow(/malformed/);
		expect(() => parsePublishableKey("qb_pk_shop1_")).toThrow(
			/qb_pk_<shopPrefix>_<secret>/,
		);
	});
});

describe("redactKey", () => {
	it("keeps the shop prefix and masks the secret", () => {
		const actual = redactKey("qb_pk_shop1_supersecretvalue");
		expect(actual).toContain("qb_pk_shop1");
		expect(actual).not.toContain("supersecretvalue");
	});
});
