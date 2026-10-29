import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConsentCookie } from "../src/consent/cookie.js";
import { ConsentStore } from "../src/consent/store.js";
import type { ConsentState } from "../src/consent/types.js";
import {
	ConsentBanner,
	type ConsentBannerState,
	ConsentGate,
	ConsentProvider,
	useConsent,
	useOptionalConsent,
} from "../src/react/consent.js";
import { ShopkitConfigError } from "../src/sdk/errors.js";

const DECIDED_ANALYTICS_ONLY: ConsentState = {
	status: "decided",
	analytics: true,
	marketing: false,
	decidedAt: "2026-10-01T10:00:00.000Z",
	revision: 1,
};

function clearCookies(): void {
	for (const cookie of document.cookie.split(";")) {
		const name = cookie.split("=")[0]?.trim();
		// biome-ignore lint/suspicious/noDocumentCookie: expiring a cookie is exactly what the raw setter is for, and CookieStore is not in happy-dom.
		if (name) document.cookie = `${name}=; max-age=0; path=/`;
	}
}

/** The dialog's checkbox for one category, or a named failure. */
function checkbox(dialog: HTMLElement, category: string): HTMLInputElement {
	const found = dialog.querySelector<HTMLInputElement>(
		`input[data-qb-consent="${category}"]`,
	);
	if (!found) throw new Error(`no checkbox for ${category}`);
	return found;
}

beforeEach(() => {
	clearCookies();
	document.documentElement.lang = "";
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useConsent", () => {
	it("throws a named error without a provider", () => {
		function Orphan() {
			useConsent();
			return null;
		}
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => render(<Orphan />)).toThrow(ShopkitConfigError);
		expect(() => render(<Orphan />)).toThrow(/ConsentProvider/);
	});

	it("is null from useOptionalConsent without a provider", () => {
		let actual: unknown = "unset";
		function Probe() {
			actual = useOptionalConsent();
			return null;
		}
		render(<Probe />);
		expect(actual).toBeNull();
	});

	it("exposes the decision, allows() and the actions", () => {
		const seen: ReturnType<typeof useConsent>[] = [];
		function Probe() {
			seen.push(useConsent());
			return null;
		}
		render(
			<ConsentProvider>
				<Probe />
			</ConsentProvider>,
		);

		const initial = seen.at(-1);
		expect(initial?.status).toBe("undecided");
		expect(initial?.allows("necessary")).toBe(true);
		expect(initial?.allows("analytics")).toBe(false);
		expect(initial?.allows("marketing")).toBe(false);

		act(() => initial?.save({ analytics: true, marketing: false }));

		const decided = seen.at(-1);
		expect(decided?.status).toBe("decided");
		expect(decided?.allows("analytics")).toBe(true);
		expect(decided?.allows("marketing")).toBe(false);
		expect(decided?.store).toBe(initial?.store);
	});

	it("keeps one store across re-renders with fresh option literals", () => {
		const seen: ConsentStore[] = [];
		function Probe() {
			seen.push(useConsent().store);
			return null;
		}
		const { rerender } = render(
			<ConsentProvider revision={2}>
				<Probe />
			</ConsentProvider>,
		);
		rerender(
			<ConsentProvider revision={2}>
				<Probe />
			</ConsentProvider>,
		);
		expect(seen).toHaveLength(2);
		expect(seen[1]).toBe(seen[0]);
		expect(seen[0]?.revision).toBe(2);
	});

	it("adopts a store built outside React and follows it", () => {
		const inputStore = new ConsentStore({ persist: false });
		render(
			<ConsentProvider store={inputStore}>
				<ConsentBanner />
			</ConsentProvider>,
		);
		expect(screen.getByRole("dialog")).toBeTruthy();

		act(() => inputStore.acceptAll());

		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

describe("<ConsentBanner> default markup", () => {
	it("renders an accessible dialog with Swedish copy for lang=sv", () => {
		render(
			<ConsentProvider>
				<ConsentBanner lang="sv" />
			</ConsentProvider>,
		);

		const dialog = screen.getByRole("dialog");
		expect(dialog.className).toBe("qb-consent");
		expect(dialog.getAttribute("aria-modal")).toBe("false");
		expect(dialog.dataset.status).toBe("undecided");
		expect(dialog.dataset.open).toBe("false");

		const titleId = dialog.getAttribute("aria-labelledby") ?? "";
		const descriptionId = dialog.getAttribute("aria-describedby") ?? "";
		expect(document.getElementById(titleId)?.textContent).toBe(
			"Vi använder cookies",
		);
		expect(document.getElementById(descriptionId)?.textContent).toContain(
			"Du väljer själv vad du tillåter.",
		);

		expect(screen.getByText("Godkänn alla").dataset.qbAction).toBe(
			"accept-all",
		);
		expect(screen.getByText("Endast nödvändiga").dataset.qbAction).toBe(
			"reject-all",
		);
		expect(screen.getByText("Inställningar").dataset.qbAction).toBe(
			"open-settings",
		);
		// Closed: no categories, no save button, no privacy link.
		expect(dialog.querySelector("fieldset")).toBeNull();
		expect(screen.queryByText("Spara val")).toBeNull();
		expect(dialog.querySelector("a.qb-consent__policy")).toBeNull();
	});

	it("gives accept-all and reject-all the same element and class", () => {
		render(
			<ConsentProvider>
				<ConsentBanner />
			</ConsentProvider>,
		);
		const accept = screen.getByText("Accept all");
		const reject = screen.getByText("Only necessary");
		expect(accept.tagName).toBe(reject.tagName);
		expect(accept.className.split(" ")[0]).toBe("qb-consent__button");
		expect(reject.className.split(" ")[0]).toBe("qb-consent__button");
	});

	it("falls back to English, and adds the privacy link only when given a URL", () => {
		const { rerender } = render(
			<ConsentProvider>
				<ConsentBanner className="my-banner" />
			</ConsentProvider>,
		);
		expect(screen.getByText("We use cookies")).toBeTruthy();
		expect(screen.getByRole("dialog").className).toBe("qb-consent my-banner");
		expect(screen.queryByText("Privacy policy")).toBeNull();

		rerender(
			<ConsentProvider>
				<ConsentBanner className="my-banner" privacyPolicyUrl="/privacy" />
			</ConsentProvider>,
		);
		const link = screen.getByText("Privacy policy");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/privacy");
		expect(link.className).toBe("qb-consent__policy");
	});

	it("reads the language off <html lang> when none is given, and honours label overrides", () => {
		document.documentElement.lang = "sv-SE";
		render(
			<ConsentProvider>
				<ConsentBanner labels={{ acceptAll: "Ja tack" }} />
			</ConsentProvider>,
		);
		expect(screen.getByText("Vi använder cookies")).toBeTruthy();
		expect(screen.getByText("Ja tack").dataset.qbAction).toBe("accept-all");
	});

	it("renders nothing once decided, unless showWhenDecided", () => {
		const inputStore = new ConsentStore({
			initialState: DECIDED_ANALYTICS_ONLY,
		});
		const { container, rerender } = render(
			<ConsentProvider store={inputStore}>
				<ConsentBanner />
			</ConsentProvider>,
		);
		expect(container.innerHTML).toBe("");

		rerender(
			<ConsentProvider store={inputStore}>
				<ConsentBanner showWhenDecided />
			</ConsentProvider>,
		);
		expect(screen.getByRole("dialog").dataset.status).toBe("decided");
	});

	it("is absent on the very first render when the provider knows the decision", () => {
		const { container } = render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ConsentBanner />
			</ConsentProvider>,
		);
		// Synchronous, no waiting: a shopper who decided never sees it flash.
		expect(container.innerHTML).toBe("");
	});

	it("is present on the very first render for an undecided initialState", () => {
		render(
			<ConsentProvider initialState={null}>
				<ConsentBanner />
			</ConsentProvider>,
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("comes back with the categories when a sibling opens the settings", () => {
		function Footer() {
			const { openSettings } = useConsent();
			return (
				<button type="button" onClick={openSettings}>
					Cookie settings
				</button>
			);
		}
		render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ConsentBanner />
				<Footer />
			</ConsentProvider>,
		);
		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByText("Cookie settings"));

		const dialog = screen.getByRole("dialog");
		expect(dialog.dataset.open).toBe("true");
		expect(dialog.dataset.status).toBe("decided");
		expect(
			dialog.querySelector("fieldset.qb-consent__categories"),
		).toBeTruthy();
		expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);

		const necessary = checkbox(dialog, "necessary");
		expect(necessary.checked).toBe(true);
		expect(necessary.disabled).toBe(true);
		// The draft is seeded from the stored decision.
		expect(checkbox(dialog, "analytics").checked).toBe(true);
		expect(checkbox(dialog, "marketing").checked).toBe(false);
		// Save replaces Settings while the panel is open.
		expect(screen.getByText("Save choices").dataset.qbAction).toBe("save");
		expect(screen.queryByText("Settings")).toBeNull();
		// Focus lands on the first choice the shopper can actually make.
		expect(document.activeElement).toBe(checkbox(dialog, "analytics"));
	});

	it("saves the draft and writes the qb_consent cookie", () => {
		render(
			<ConsentProvider>
				<ConsentBanner />
			</ConsentProvider>,
		);
		fireEvent.click(screen.getByText("Settings"));
		const dialog = screen.getByRole("dialog");
		expect(checkbox(dialog, "analytics").checked).toBe(false);

		fireEvent.click(checkbox(dialog, "analytics"));
		expect(checkbox(dialog, "analytics").checked).toBe(true);
		expect(checkbox(dialog, "marketing").checked).toBe(false);

		fireEvent.click(screen.getByText("Save choices"));

		expect(document.cookie).toContain("qb_consent=");
		expect(readConsentCookie(document.cookie)).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: false,
		});
		// Decided and closed: the banner leaves.
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("accept-all and reject-all decide without opening the panel", () => {
		const { rerender } = render(
			<ConsentProvider>
				<ConsentBanner />
			</ConsentProvider>,
		);
		fireEvent.click(screen.getByText("Accept all"));
		expect(readConsentCookie(document.cookie)).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: true,
		});

		clearCookies();
		rerender(
			<ConsentProvider>
				<ConsentBanner showWhenDecided />
			</ConsentProvider>,
		);
		fireEvent.click(screen.getByText("Only necessary"));
		expect(readConsentCookie(document.cookie)).toMatchObject({
			status: "decided",
			analytics: false,
			marketing: false,
		});
	});

	it("re-shows the banner after reset()", () => {
		function Withdraw() {
			const { reset } = useConsent();
			return (
				<button type="button" onClick={reset}>
					withdraw
				</button>
			);
		}
		render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ConsentBanner />
				<Withdraw />
			</ConsentProvider>,
		);
		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByText("withdraw"));

		expect(screen.getByRole("dialog").dataset.status).toBe("undecided");
	});
});

describe("<ConsentBanner> render prop", () => {
	it("hands the state to children and renders nothing else", () => {
		const seen: ConsentBannerState[] = [];
		const { container } = render(
			<ConsentProvider>
				<ConsentBanner lang="sv">
					{(state) => {
						seen.push(state);
						return <aside data-testid="mine">{state.labels.acceptAll}</aside>;
					}}
				</ConsentBanner>
			</ConsentProvider>,
		);

		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(container.querySelector(".qb-consent")).toBeNull();
		expect(screen.getByTestId("mine").textContent).toBe("Godkänn alla");
		expect(seen.at(-1)).toMatchObject({
			status: "undecided",
			visible: true,
			open: false,
			draft: { analytics: false, marketing: false },
		});
	});

	it("saves the draft the children built, then leaves", () => {
		const seen: ConsentBannerState[] = [];
		const { container } = render(
			<ConsentProvider>
				<ConsentBanner>
					{(state) => {
						seen.push(state);
						return <span>banner</span>;
					}}
				</ConsentBanner>
			</ConsentProvider>,
		);

		act(() => seen.at(-1)?.setDraft({ marketing: true }));
		expect(seen.at(-1)?.draft).toEqual({ analytics: false, marketing: true });

		act(() => seen.at(-1)?.save());

		expect(readConsentCookie(document.cookie)).toMatchObject({
			status: "decided",
			analytics: false,
			marketing: true,
		});
		// Decided, so not visible: the children are not even called.
		expect(container.innerHTML).toBe("");
	});

	it("re-seeds the draft from the decision every time the panel opens", () => {
		const seen: ConsentBannerState[] = [];
		render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ConsentBanner showWhenDecided>
					{(state) => {
						seen.push(state);
						return <span>banner</span>;
					}}
				</ConsentBanner>
			</ConsentProvider>,
		);
		expect(seen.at(-1)?.draft).toEqual({ analytics: true, marketing: false });

		act(() => seen.at(-1)?.openSettings());
		act(() => seen.at(-1)?.setDraft({ analytics: false }));
		expect(seen.at(-1)?.draft).toEqual({ analytics: false, marketing: false });

		// Closed without saving, then reopened: what is stored, not what was ticked.
		act(() => seen.at(-1)?.closeSettings());
		act(() => seen.at(-1)?.openSettings());
		expect(seen.at(-1)?.open).toBe(true);
		expect(seen.at(-1)?.draft).toEqual({ analytics: true, marketing: false });
	});
});

describe("<ConsentGate>", () => {
	function Accept() {
		const { acceptAll } = useConsent();
		return (
			<button type="button" onClick={acceptAll}>
				yes
			</button>
		);
	}

	it("renders the fallback until the category is allowed", () => {
		render(
			<ConsentProvider>
				<ConsentGate category="marketing" fallback={<span>blocked</span>}>
					<span>widget</span>
				</ConsentGate>
				<ConsentGate category="necessary">
					<span>always</span>
				</ConsentGate>
				<Accept />
			</ConsentProvider>,
		);
		expect(screen.getByText("blocked")).toBeTruthy();
		expect(screen.queryByText("widget")).toBeNull();
		expect(screen.getByText("always")).toBeTruthy();

		fireEvent.click(screen.getByText("yes"));

		expect(screen.getByText("widget")).toBeTruthy();
		expect(screen.queryByText("blocked")).toBeNull();
	});

	it("renders nothing without a fallback, and honours a decided initialState at once", () => {
		const { container } = render(
			<ConsentProvider initialState={DECIDED_ANALYTICS_ONLY}>
				<ConsentGate category="analytics">
					<span>stats</span>
				</ConsentGate>
				<ConsentGate category="marketing">
					<span>ads</span>
				</ConsentGate>
			</ConsentProvider>,
		);
		expect(screen.getByText("stats")).toBeTruthy();
		expect(screen.queryByText("ads")).toBeNull();
		expect(container.textContent).toBe("stats");
	});

	it("throws without a provider, like the hooks", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() =>
			render(
				<ConsentGate category="analytics">
					<span>stats</span>
				</ConsentGate>,
			),
		).toThrow(ShopkitConfigError);
	});
});
