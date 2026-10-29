import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};

/**
 * Two configs: ONE for every module entry, and one for the script tag.
 *
 * The four module entries (`.`, `/sdk`, `/react`, `/elements`) MUST share a
 * config. tsup bundles each config in isolation, so separate configs would each
 * emit their own copy of the SDK's classes — and then a `ShopkitClient` from one
 * entry is not assignable across entries (private members make classes
 * nominal), and `instanceof ShopkitApiError` fails for errors thrown by another
 * entry's copy. One config with `splitting` gives one shared chunk and one
 * shared `.d.ts`; `scripts/check-entries.mjs` verifies both on every build.
 *
 * No `banner` for `"use client"`: `src/react/index.ts` opens with the directive,
 * and esbuild keeps an entry's directives at the top of that entry's output
 * only. In the CJS output it lands after the interop helpers and is no longer a
 * directive; accepted, because bundlers that honour it read the ESM build.
 *
 * `react` is external; only the React entry imports it, as an optional peer.
 */
export default defineConfig([
	{
		name: "modules",
		entry: {
			index: "src/index.ts",
			"sdk/index": "src/sdk/index.ts",
			"react/index": "src/react/index.ts",
			"elements/index": "src/elements/index.ts",
		},
		format: ["esm", "cjs"],
		dts: true,
		splitting: true,
		clean: false,
		outDir: "dist",
		external: ["react"],
	},
	{
		/**
		 * The script-tag build: one self-contained file for a page with no
		 * bundler, so its own copy of the SDK is intended. It sets
		 * `window.Quickbutik` itself rather than using esbuild's `globalName`,
		 * which would make every call read `Quickbutik.default.configure(…)`.
		 */
		name: "global",
		entry: { "quickbutik-kit.global": "src/global.ts" },
		format: ["iife"],
		dts: false,
		splitting: false,
		clean: false,
		outDir: "dist",
		platform: "browser",
		target: "es2020",
		minify: true,
		define: { __KIT_VERSION__: JSON.stringify(version) },
		outExtension: () => ({ js: ".js" }),
	},
]);
