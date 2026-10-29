import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// happy-dom FETCHES an iframe's `src` for real the moment the frame is
// connected, which for the embedded-checkout tests would be a DNS lookup for
// `checkout.test` on every mount. Switched off here rather than per suite,
// because no test in this package wants a network round trip. happy-dom
// announces the refusal on its virtual console; `vitest.config.ts` filters that
// one line so the refusal does not read as a failure.
const happyDom = (
	globalThis as unknown as { happyDOM?: { settings?: Record<string, unknown> } }
).happyDOM;
if (happyDom?.settings) {
	happyDom.settings.disableIframePageLoading = true;
	// The analytics destinations inject `<script src>` tags for gtag.js, GTM
	// and the Meta Pixel. happy-dom would fetch those for real; the tests only
	// care that the tag was added, so loading is switched off the same way.
	happyDom.settings.disableJavaScriptFileLoading = true;
}

// Testing Library's automatic cleanup only registers itself when the test
// framework exposes `afterEach` as a global, which this project does not.
// Without it, every render stacks up in the same document and queries start
// matching elements from earlier tests.
afterEach(() => {
	cleanup();
});
