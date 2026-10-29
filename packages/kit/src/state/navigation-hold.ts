/**
 * How long a hold waits for the page to unload before giving up on the
 * navigation and releasing anyway.
 */
export const NAVIGATION_HOLD_FALLBACK_MS = 10_000;

/**
 * Run `release` when this page comes back from the back/forward cache, and
 * not before. For the busy flag of a button that has just navigated to the
 * hosted checkout, so it cannot be clicked twice while the navigation commits.
 *
 * If no `pagehide` fires within `fallbackMs` (the navigation was cancelled
 * or did not unload the page), it releases anyway. `release` runs at most
 * once.
 */
export function releaseOnRestore(
	release: () => void,
	fallbackMs: number = NAVIGATION_HOLD_FALLBACK_MS,
): void {
	if (typeof window === "undefined") {
		release();
		return;
	}
	let released = false;
	const finish = (): void => {
		if (released) return;
		released = true;
		clearTimeout(timer);
		window.removeEventListener("pageshow", onShow);
		window.removeEventListener("pagehide", onHide);
		release();
	};
	const onShow = (event: PageTransitionEvent): void => {
		if (event.persisted) finish();
	};
	// The navigation committed: only a back/forward restore releases now.
	const onHide = (): void => clearTimeout(timer);
	const timer = setTimeout(finish, fallbackMs);
	window.addEventListener("pageshow", onShow);
	window.addEventListener("pagehide", onHide);
}
