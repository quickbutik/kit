import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Node, not happy-dom: this suite talks to a real gateway, and happy-dom's
		// partial `AbortSignal`/fetch shims are the wrong thing to test against.
		environment: "node",
		include: ["tests/integration/**/*.test.ts"],
		// Sequential and generous: each step depends on the previous one's state
		// (a cart, then a session, then an order), and a live environment is slow.
		fileParallelism: false,
		sequence: { concurrent: false },
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
