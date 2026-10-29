import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	NAVIGATION_HOLD_FALLBACK_MS,
	releaseOnRestore,
} from "../src/state/navigation-hold.js";

function pageTransition(
	type: "pageshow" | "pagehide",
	persisted: boolean,
): Event {
	return Object.assign(new Event(type), { persisted });
}

describe("releaseOnRestore()", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("releases when the page is restored from the back/forward cache", () => {
		const release = vi.fn();
		releaseOnRestore(release);

		window.dispatchEvent(pageTransition("pageshow", false));
		expect(release).not.toHaveBeenCalled();

		window.dispatchEvent(pageTransition("pagehide", true));
		window.dispatchEvent(pageTransition("pageshow", true));
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("releases after the fallback when the page never unloads", () => {
		// "Stay" on a beforeunload prompt, a 204, a download, a blocked
		// navigation: no pagehide, so nothing else would ever release it.
		const release = vi.fn();
		releaseOnRestore(release);

		vi.advanceTimersByTime(NAVIGATION_HOLD_FALLBACK_MS - 1);
		expect(release).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("does not fall back once a pagehide has fired", () => {
		const release = vi.fn();
		releaseOnRestore(release);

		window.dispatchEvent(pageTransition("pagehide", true));
		vi.advanceTimersByTime(NAVIGATION_HOLD_FALLBACK_MS * 2);
		expect(release).not.toHaveBeenCalled();

		window.dispatchEvent(pageTransition("pageshow", true));
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("releases at most once and cleans up after itself", () => {
		const release = vi.fn();
		const remove = vi.spyOn(window, "removeEventListener");
		releaseOnRestore(release);

		vi.advanceTimersByTime(NAVIGATION_HOLD_FALLBACK_MS);
		window.dispatchEvent(pageTransition("pageshow", true));
		vi.advanceTimersByTime(NAVIGATION_HOLD_FALLBACK_MS);
		expect(release).toHaveBeenCalledTimes(1);
		expect(remove.mock.calls.map(([type]) => type).sort()).toEqual([
			"pagehide",
			"pageshow",
		]);
		expect(vi.getTimerCount()).toBe(0);
		remove.mockRestore();
	});

	it("clears the fallback timer when a restore releases first", () => {
		const release = vi.fn();
		releaseOnRestore(release);

		window.dispatchEvent(pageTransition("pageshow", true));
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(NAVIGATION_HOLD_FALLBACK_MS);
		expect(release).toHaveBeenCalledTimes(1);
	});
});
