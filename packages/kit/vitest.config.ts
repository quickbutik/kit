import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};

export default defineConfig({
	// `src/global.ts` — the script-tag entry — reads its version from a constant
	// tsup replaces at bundle time. The suite runs the source, not the bundle, so
	// the same substitution has to happen here.
	define: { __KIT_VERSION__: JSON.stringify(version) },
	test: {
		environment: "happy-dom",
		setupFiles: ["./tests/setup.ts"],
		// Integration tests need a live environment and their own config — see
		// vitest.integration.config.ts and the header of the suite itself.
		exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
		/**
		 * Iframe page loading is disabled in `tests/setup.ts`, and happy-dom
		 * reports every refusal with a full stack, once per mounted
		 * `<qb-checkout>`. The refusal is expected, so only this message is dropped.
		 */
		onConsoleLog(log) {
			if (log.includes("Iframe page loading is disabled")) return false;
			// Same story for the vendor <script src> tags the analytics
			// destinations inject — see `disableJavaScriptFileLoading` in setup.
			if (log.includes("JavaScript file loading is disabled")) return false;
		},
	},
});
