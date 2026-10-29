import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentStore } from "../../src/consent/store.js";
import {
	configure,
	getAmbientConsent,
	requireAmbientConsent,
} from "../../src/elements/index.js";
import { TEST_KEY } from "../helpers.js";
import {
	$,
	$$,
	at,
	ensureDefined,
	flush,
	mount,
	resetDom,
	text,
} from "./helpers.js";

ensureDefined();

describe("<qb-consent-banner>", () => {
	beforeEach(resetDom);

	it("renders the default dialog when given no markup", async () => {
		const host = await mount(
			`<qb-consent-banner lang="sv"></qb-consent-banner>`,
		);
		const banner = $(host, "qb-consent-banner");

		expect(banner.getAttribute("role")).toBe("dialog");
		expect(banner.getAttribute("aria-modal")).toBe("false");
		expect(banner.classList.contains("qb-consent")).toBe(true);
		expect(banner.getAttribute("aria-labelledby")).toBe(
			$(host, ".qb-consent__title").id,
		);
		expect(text(host, ".qb-consent__title")).toBe("Vi använder cookies");
		expect(text(host, '[data-qb-action="accept-all"]')).toBe("Godkänn alla");
		expect(text(host, '[data-qb-action="reject-all"]')).toBe(
			"Endast nödvändiga",
		);
		expect(banner.getAttribute("status")).toBe("undecided");
		expect(banner.hidden).toBe(false);
		expect(banner.hasAttribute("open")).toBe(false);
		// The preferences panel waits for "Settings"; the policy link waits for
		// a URL to point at.
		expect($(host, ".qb-consent__categories").hidden).toBe(true);
		expect($(host, ".qb-consent__policy").hidden).toBe(true);
	});

	it("shows the privacy policy link only when given a URL", async () => {
		const host = await mount(
			`<qb-consent-banner privacy-policy-url="/privacy"></qb-consent-banner>`,
		);
		const link = $(host, ".qb-consent__policy");
		expect(link.hidden).toBe(false);
		expect(link.getAttribute("href")).toBe("/privacy");
		expect(link.textContent).toBe("Privacy policy");
	});

	it("re-labels itself when lang changes", async () => {
		const host = await mount(`<qb-consent-banner></qb-consent-banner>`);
		expect(text(host, ".qb-consent__title")).toBe("We use cookies");

		$(host, "qb-consent-banner").setAttribute("lang", "da");
		await flush();

		expect(text(host, ".qb-consent__title")).toBe("Vi bruger cookies");
	});

	it("accept-all decides, hides the banner, writes the cookie and announces", async () => {
		const announced = vi.fn();
		document.addEventListener("qb:consent", announced);
		const host = await mount(`<qb-consent-banner></qb-consent-banner>`);
		const banner = $(host, "qb-consent-banner");

		$(host, '[data-qb-action="accept-all"]').click();
		await flush();

		expect(banner.getAttribute("status")).toBe("decided");
		expect(banner.hidden).toBe(true);
		expect(document.cookie).toContain("qb_consent=");
		expect(requireAmbientConsent().allows("analytics")).toBe(true);
		expect(requireAmbientConsent().allows("marketing")).toBe(true);
		expect(announced).toHaveBeenCalledTimes(1);
		const event = at(announced.mock.calls, 0)[0] as CustomEvent;
		expect(event.detail).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: true,
		});
		document.removeEventListener("qb:consent", announced);
	});

	it("reject-all decides with nothing optional granted", async () => {
		const host = await mount(`<qb-consent-banner></qb-consent-banner>`);

		$(host, '[data-qb-action="reject-all"]').click();
		await flush();

		const store = requireAmbientConsent();
		expect(store.getSnapshot()).toMatchObject({
			status: "decided",
			analytics: false,
			marketing: false,
		});
		expect(store.allows("analytics")).toBe(false);
		expect($(host, "qb-consent-banner").hidden).toBe(true);
		expect(document.cookie).toContain("qb_consent=");
	});

	it("open-settings shows the categories and save reads the checkboxes", async () => {
		const host = await mount(`<qb-consent-banner></qb-consent-banner>`);
		const banner = $(host, "qb-consent-banner");
		const fieldset = $(host, ".qb-consent__categories");

		$(host, '[data-qb-action="open-settings"]').click();
		await flush();

		expect(banner.hasAttribute("open")).toBe(true);
		expect(fieldset.hidden).toBe(false);
		expect($(host, '[data-qb-action="open-settings"]').hidden).toBe(true);
		expect($(host, '[data-qb-action="save"]').hidden).toBe(false);
		// Focus lands on the first choice the shopper can actually make — the
		// necessary box is disabled.
		expect(document.activeElement).toBe(
			$(host, 'input[data-qb-consent="analytics"]'),
		);

		const analyticsBox = $(
			host,
			'input[data-qb-consent="analytics"]',
		) as HTMLInputElement;
		analyticsBox.checked = true;
		$(host, '[data-qb-action="save"]').click();
		await flush();

		expect(requireAmbientConsent().getSnapshot()).toMatchObject({
			status: "decided",
			analytics: true,
			marketing: false,
			open: false,
		});
		expect(banner.hasAttribute("open")).toBe(false);
		expect(banner.hidden).toBe(true);
	});

	it("syncs the checkboxes from the decision when the panel reopens", async () => {
		requireAmbientConsent().save({ analytics: false, marketing: true });
		const host = await mount(
			`<qb-consent-banner show-when-decided></qb-consent-banner>`,
		);

		$(host, '[data-qb-action="open-settings"]').click();
		await flush();

		expect(
			($(host, 'input[data-qb-consent="analytics"]') as HTMLInputElement)
				.checked,
		).toBe(false);
		expect(
			($(host, 'input[data-qb-consent="marketing"]') as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(
			($(host, 'input[data-qb-consent="necessary"]') as HTMLInputElement)
				.disabled,
		).toBe(true);
	});

	it("binds merchant markup instead of rendering its own", async () => {
		const host = await mount(`
			<qb-consent-banner show-when-decided>
				<h2 id="title" data-qb-text="consent.labels.title"></h2>
				<p id="thanks" data-qb-show="consent.decided">Tack!</p>
				<button id="no" data-qb-action="reject-all">Bara nödvändiga</button>
				<button id="yes" data-qb-action="accept-all">Okej</button>
			</qb-consent-banner>
		`);
		const banner = $(host, "qb-consent-banner");

		expect(banner.classList.contains("qb-consent")).toBe(false);
		expect(banner.hasAttribute("role")).toBe(false);
		expect($$(host, ".qb-consent__title")).toHaveLength(0);
		expect(text(host, "#title")).toBe("We use cookies");
		expect($(host, "#thanks").hidden).toBe(true);

		$(host, "#yes").click();
		await flush();

		expect(banner.getAttribute("status")).toBe("decided");
		expect($(host, "#thanks").hidden).toBe(false);
		// `show-when-decided` keeps it on the page.
		expect(banner.hidden).toBe(false);
	});

	it("exposes the open/close verbs to merchant markup", async () => {
		const host = await mount(`
			<qb-consent-banner>
				<button id="open" data-qb-action="open-settings" data-qb-hide="consent.open">Inställningar</button>
				<div id="panel" data-qb-show="consent.open">
					<label><input type="checkbox" data-qb-consent="marketing"> Marknadsföring</label>
					<button id="close" data-qb-action="close-settings">Stäng</button>
				</div>
			</qb-consent-banner>
		`);

		expect($(host, "#panel").hidden).toBe(true);
		$(host, "#open").click();
		await flush();
		expect($(host, "#panel").hidden).toBe(false);
		expect($(host, "#open").hidden).toBe(true);

		$(host, "#close").click();
		await flush();
		expect($(host, "#panel").hidden).toBe(true);
		expect(requireAmbientConsent().getSnapshot().status).toBe("undecided");
	});

	it("creates the ambient store lazily, so a page needs no configuration", async () => {
		expect(getAmbientConsent()).toBeNull();
		await mount(`<qb-consent-banner></qb-consent-banner>`);
		expect(getAmbientConsent()).toBeInstanceOf(ConsentStore);
	});

	it("reads a decision for another revision as undecided", async () => {
		// A shopper decided under revision 1 …
		new ConsentStore({ revision: 1 }).acceptAll();
		expect(document.cookie).toContain("qb_consent=");

		// … and the policy changed.
		configure({
			publishableKey: TEST_KEY,
			apiUrl: "https://gateway.test",
			maxRetries: 0,
			consent: { revision: 2 },
			analytics: false,
		});
		const host = await mount(`<qb-consent-banner></qb-consent-banner>`);

		const banner = $(host, "qb-consent-banner");
		expect(banner.getAttribute("status")).toBe("undecided");
		expect(banner.hidden).toBe(false);
		expect(getAmbientConsent()?.revision).toBe(2);
	});
});

describe("<qb-consent-settings>", () => {
	beforeEach(resetDom);

	it("reopens a decided banner from anywhere on the page", async () => {
		const host = await mount(`
			<qb-consent-banner></qb-consent-banner>
			<footer>
				<qb-consent-settings><button id="link">Cookie settings</button></qb-consent-settings>
			</footer>
		`);
		const banner = $(host, "qb-consent-banner");
		const settings = $(host, "qb-consent-settings");

		$(host, '[data-qb-action="accept-all"]').click();
		await flush();
		expect(banner.hidden).toBe(true);
		expect(settings.getAttribute("status")).toBe("decided");

		$(host, "#link").click();
		await flush();

		expect(banner.hidden).toBe(false);
		expect(banner.hasAttribute("open")).toBe(true);
		expect(settings.hasAttribute("open")).toBe(true);
		expect($(host, ".qb-consent__categories").hidden).toBe(false);
		expect(
			($(host, 'input[data-qb-consent="marketing"]') as HTMLInputElement)
				.checked,
		).toBe(true);
	});
});

describe("<qb-consent-gate>", () => {
	beforeEach(resetDom);

	it("clones the template only once marketing is granted, and removes it on reset", async () => {
		const host = await mount(`
			<qb-consent-gate category="marketing">
				<template><iframe id="video" src="https://video.test/embed/1"></iframe></template>
				<p id="placeholder">Accept marketing cookies to watch.</p>
			</qb-consent-gate>
		`);
		const gate = $(host, "qb-consent-gate");

		expect(gate.getAttribute("state")).toBe("denied");
		expect(host.querySelector("#video")).toBeNull();
		expect($(host, "#placeholder").hidden).toBe(false);

		// Analytics alone is not marketing.
		requireAmbientConsent().save({ analytics: true, marketing: false });
		await flush();
		expect(gate.getAttribute("state")).toBe("denied");
		expect(host.querySelector("#video")).toBeNull();

		requireAmbientConsent().save({ analytics: true, marketing: true });
		await flush();
		expect(gate.getAttribute("state")).toBe("granted");
		expect(host.querySelector("#video")).not.toBeNull();
		expect($(host, "#placeholder").hidden).toBe(true);
		// The template stays a template; the clone is a sibling after the placeholder.
		expect($$(host, "qb-consent-gate > template")).toHaveLength(1);
		expect(gate.lastElementChild?.id).toBe("video");

		requireAmbientConsent().reset();
		await flush();
		expect(gate.getAttribute("state")).toBe("denied");
		expect(host.querySelector("#video")).toBeNull();
		expect($(host, "#placeholder").hidden).toBe(false);
	});

	it("shows the content straight away for a shopper who already granted it", async () => {
		requireAmbientConsent().acceptAll();
		const host = await mount(`
			<qb-consent-gate category="analytics">
				<template><span id="widget">chart</span></template>
			</qb-consent-gate>
		`);

		expect($(host, "qb-consent-gate").getAttribute("state")).toBe("granted");
		expect(host.querySelector("#widget")).not.toBeNull();
	});

	it("reports an invalid category instead of guessing one", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = vi.fn();
		document.addEventListener("qb:error", failed);
		const host = await mount(
			`<qb-consent-gate category="cookies"><template><b>x</b></template></qb-consent-gate>`,
		);

		expect($(host, "qb-consent-gate").getAttribute("state")).toBe("error");
		expect(failed).toHaveBeenCalledTimes(1);
		document.removeEventListener("qb:error", failed);
		error.mockRestore();
	});
});
