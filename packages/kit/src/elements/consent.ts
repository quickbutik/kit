import { type ConsentLabels, consentLabels } from "../consent/labels.js";
import type { ConsentStore } from "../consent/store.js";
import { injectConsentStyles } from "../consent/styles.js";
import type {
	ConsentSnapshot,
	OptionalConsentCategory,
} from "../consent/types.js";
import { claimAction, delegateActions } from "./actions.js";
import { QbElement } from "./base.js";
import type { Scope } from "./bindings.js";
import {
	AUTO_BANNER_ATTR,
	isConsentDisabled,
	requireAmbientConsent,
} from "./consent-context.js";
import { QbScopeElement } from "./scope.js";

/**
 * `<qb-consent-banner>` — the cookie banner, headless.
 *
 * ```html
 * <qb-consent-banner lang="sv" privacy-policy-url="/integritet"></qb-consent-banner>
 * ```
 *
 * Given no children it renders a minimal, accessible dialog of its own (the
 * one exception to "the elements add no markup"), with stable `qb-consent*`
 * class names and copy from the built-in labels for `lang`, falling back to
 * `<html lang>` and then English. Its stylesheet goes in `<head>` in
 * `@layer qb-consent`, so the page's own rules win, and is themed through
 * `--qb-consent-*` custom properties. `unstyled` leaves it out.
 *
 * A configured page gets one appended to `<body>` automatically; placing one
 * yourself replaces it.
 *
 * Given children, it binds them instead:
 *
 * ```html
 * <qb-consent-banner>
 *   <h2 data-qb-text="consent.labels.title"></h2>
 *   <button data-qb-action="reject-all">Only necessary</button>
 *   <button data-qb-action="accept-all">Accept all</button>
 *   <button data-qb-action="open-settings" data-qb-hide="consent.open">Settings</button>
 *   <fieldset data-qb-show="consent.open">
 *     <label><input type="checkbox" data-qb-consent="analytics"> Analytics</label>
 *     <label><input type="checkbox" data-qb-consent="marketing"> Marketing</label>
 *     <button data-qb-action="save">Save</button>
 *   </fieldset>
 * </qb-consent-banner>
 * ```
 *
 * Actions: `accept-all`, `reject-all`, `save` (reads every
 * `input[data-qb-consent]` inside the banner), `open-settings`,
 * `close-settings`. Scope: `consent.status`, `consent.undecided`,
 * `consent.decided`, `consent.open`, `consent.analytics`, `consent.marketing`,
 * `consent.labels.*`, `consent.privacyPolicyUrl`.
 *
 * Reflected: `status="undecided|decided"`, `open` while the preferences panel
 * is shown, and `hidden` once the shopper has decided, unless
 * `show-when-decided` is set or the panel is reopened (see
 * `<qb-consent-settings>`). The decision lives in the page's ambient
 * `ConsentStore` (see `configureConsent`), which writes the `qb_consent`
 * cookie and dispatches `qb:consent` on `document`.
 */
export class QbConsentBannerElement extends QbScopeElement {
	static observedAttributes = [
		"lang",
		"privacy-policy-url",
		"show-when-decided",
	];

	private store: ConsentStore | null = null;
	private snapshot: ConsentSnapshot | null = null;
	private wasOpen = false;

	protected start(): void {
		if (this.yieldToPageBanner()) return;
		// Store before scope: `initScope()` can render synchronously, and that
		// render should already know the decision.
		const store = requireAmbientConsent();
		this.store = store;
		this.snapshot = store.getSnapshot();
		this.wasOpen = this.snapshot.open;
		this.initScope();

		if (this.childElementCount === 0) this.renderDefaultMarkup();

		this.cleanups.push(store.subscribe(() => this.onStoreChange()));
		const actions = delegateActions(this, {
			"accept-all": () => this.store?.acceptAll(),
			"reject-all": () => this.store?.rejectAll(),
			save: () => this.save(),
			"open-settings": () => this.store?.openSettings(),
			"close-settings": () => this.store?.closeSettings(),
		});
		this.cleanups.push(() => actions.dispose());

		this.syncInputs();
		this.render();
	}

	protected update(): void {
		this.render();
	}

	/**
	 * One banner per page: the auto-mounted banner yields to one the page
	 * placed, even one that arrives later. True when this element removed itself.
	 */
	private yieldToPageBanner(): boolean {
		const tag = this.tagName.toLowerCase();
		if (this.hasAttribute(AUTO_BANNER_ATTR)) {
			const placed = Array.from(document.querySelectorAll(tag)).some(
				(banner) => banner !== this && !banner.hasAttribute(AUTO_BANNER_ATTR),
			);
			if (placed) this.remove();
			return placed;
		}
		for (const auto of document.querySelectorAll(
			`${tag}[${AUTO_BANNER_ATTR}]`,
		)) {
			auto.remove();
		}
		return false;
	}

	/** Record what the checkboxes say. Missing inputs read as "no". */
	save(): void {
		this.store?.save({
			analytics: this.input("analytics")?.checked ?? false,
			marketing: this.input("marketing")?.checked ?? false,
		});
	}

	private onStoreChange(): void {
		if (!this.store) return;
		this.snapshot = this.store.getSnapshot();
		const opened = this.snapshot.open && !this.wasOpen;
		this.wasOpen = this.snapshot.open;
		this.syncInputs();
		this.render();
		if (opened) {
			// After render, so the checkbox's fieldset is visible when focused.
			this.querySelector<HTMLInputElement>(
				"input[data-qb-consent]:not([disabled])",
			)?.focus();
		}
	}

	/** The checkboxes show the decision on record, not whatever was left in them. */
	private syncInputs(): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;
		for (const category of ["analytics", "marketing"] as const) {
			const input = this.input(category);
			if (input) input.checked = snapshot[category];
		}
	}

	private input(category: OptionalConsentCategory): HTMLInputElement | null {
		return this.querySelector<HTMLInputElement>(
			`input[data-qb-consent="${category}"]`,
		);
	}

	private labels(): ConsentLabels {
		return consentLabels(this.attr("lang"));
	}

	protected ownScope(): Scope {
		const snapshot = this.snapshot;
		const status = snapshot?.status ?? "undecided";
		return {
			...this.parentScope,
			consent: {
				status,
				undecided: status === "undecided",
				decided: status === "decided",
				open: snapshot?.open ?? false,
				analytics: snapshot?.analytics ?? false,
				marketing: snapshot?.marketing ?? false,
				labels: this.labels(),
				privacyPolicyUrl: this.attr("privacy-policy-url") ?? null,
			},
		};
	}

	protected render(): void {
		const snapshot = this.snapshot;
		const decided = snapshot?.status === "decided";
		const open = snapshot?.open ?? false;
		this.setAttribute("status", decided ? "decided" : "undecided");
		this.toggleAttr("open", open);
		this.hidden = decided && !open && !this.boolAttr("show-when-decided");
		super.render();
	}

	/**
	 * The built-in dialog: constant markup whose text all comes from bindings,
	 * so a `lang` change re-labels it through the normal `render()`.
	 */
	private renderDefaultMarkup(): void {
		const id = `qb-consent-${++bannerCount}`;
		this.classList.add("qb-consent");
		if (this.boolAttr("unstyled")) this.classList.add("qb-consent--unstyled");
		else injectConsentStyles();
		this.setAttribute("role", "dialog");
		this.setAttribute("aria-modal", "false");
		this.setAttribute("aria-labelledby", `${id}-title`);
		this.setAttribute("aria-describedby", `${id}-desc`);
		// Safe: the markup is a constant, and every piece of text in it arrives
		// through `data-qb-text`, which sets `textContent`.
		this.innerHTML = `
<div class="qb-consent__body">
	<h2 class="qb-consent__title" id="${id}-title" data-qb-text="consent.labels.title"></h2>
	<p class="qb-consent__description" id="${id}-desc"><span data-qb-text="consent.labels.description"></span> <a class="qb-consent__policy" data-qb-show="consent.privacyPolicyUrl" data-qb-attr="href:consent.privacyPolicyUrl" data-qb-text="consent.labels.privacyPolicy"></a></p>
</div>
<fieldset class="qb-consent__categories" data-qb-show="consent.open">
	<label class="qb-consent__category"><input type="checkbox" checked disabled data-qb-consent="necessary"> <span class="qb-consent__category-name" data-qb-text="consent.labels.necessary"></span> <span class="qb-consent__category-description" data-qb-text="consent.labels.necessaryDescription"></span></label>
	<label class="qb-consent__category"><input type="checkbox" data-qb-consent="analytics"> <span class="qb-consent__category-name" data-qb-text="consent.labels.analytics"></span> <span class="qb-consent__category-description" data-qb-text="consent.labels.analyticsDescription"></span></label>
	<label class="qb-consent__category"><input type="checkbox" data-qb-consent="marketing"> <span class="qb-consent__category-name" data-qb-text="consent.labels.marketing"></span> <span class="qb-consent__category-description" data-qb-text="consent.labels.marketingDescription"></span></label>
</fieldset>
<div class="qb-consent__actions">
	<button type="button" class="qb-consent__button qb-consent__button--settings" data-qb-action="open-settings" data-qb-hide="consent.open" data-qb-text="consent.labels.settings"></button>
	<button type="button" class="qb-consent__button qb-consent__button--save" data-qb-action="save" data-qb-show="consent.open" data-qb-text="consent.labels.save"></button>
	<button type="button" class="qb-consent__button qb-consent__button--reject" data-qb-action="reject-all" data-qb-text="consent.labels.rejectAll"></button>
	<button type="button" class="qb-consent__button qb-consent__button--accept" data-qb-action="accept-all" data-qb-text="consent.labels.acceptAll"></button>
</div>`;
	}
}

let bannerCount = 0;

/**
 * `<qb-consent-settings>` — a "Cookie settings" link, anywhere on the page.
 *
 * ```html
 * <footer>
 *   <qb-consent-settings><button type="button">Cookie settings</button></qb-consent-settings>
 * </footer>
 * ```
 *
 * A click anywhere inside reopens the banner's preferences panel, wherever the
 * banner is (they share the page's consent store). Reflects `status` and
 * `open` like the banner.
 *
 * Left empty, it renders a `<button type="button">` with the built-in label
 * for `lang` ("Cookie settings", "Cookie-inställningar", …). Hidden when the
 * page turned consent off.
 */
export class QbConsentSettingsElement extends QbElement {
	static observedAttributes = ["lang"];

	private store: ConsentStore | null = null;
	private defaultButton: HTMLButtonElement | null = null;

	protected start(): void {
		if (isConsentDisabled()) {
			this.hidden = true;
			return;
		}
		if (this.childElementCount === 0 && !this.textContent?.trim()) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "qb-consent-settings__button";
			this.defaultButton = button;
			this.append(button);
			this.label();
		}
		const store = requireAmbientConsent();
		this.store = store;
		this.cleanups.push(store.subscribe(() => this.reflect()));

		const onClick = (event: Event): void => {
			if (event.cancelable) event.preventDefault();
			// Claimed, so a `data-qb-action` on an ancestor does not also act.
			claimAction(event);
			this.store?.openSettings();
		};
		this.addEventListener("click", onClick);
		this.cleanups.push(() => this.removeEventListener("click", onClick));
		this.reflect();
	}

	protected update(): void {
		this.label();
	}

	private label(): void {
		if (this.defaultButton) {
			this.defaultButton.textContent = consentLabels(
				this.attr("lang"),
			).cookieSettings;
		}
	}

	private reflect(): void {
		const snapshot = this.store?.getSnapshot();
		this.setAttribute("status", snapshot?.status ?? "undecided");
		this.toggleAttr("open", snapshot?.open ?? false);
	}
}

/**
 * `<qb-consent-gate>` — markup that exists only with consent.
 *
 * ```html
 * <qb-consent-gate category="marketing">
 *   <template>
 *     <iframe src="https://www.youtube.com/embed/…"></iframe>
 *   </template>
 *   <p>Accept marketing cookies to watch the video.</p>
 * </qb-consent-gate>
 * ```
 *
 * The direct `<template>` child is the gated content; every other child is
 * the placeholder. While the category is denied the content is not in the
 * document at all, so an `<iframe>` or `<script>` inside is never fetched.
 * Granting clones it in and hides the placeholder; withdrawing removes it
 * again. Reflects `state="granted|denied"`.
 */
export class QbConsentGateElement extends QbElement {
	static observedAttributes = ["category"];

	private store: ConsentStore | null = null;
	private clones: ChildNode[] = [];
	private warnedAboutTemplate = false;

	protected start(): void {
		const store = requireAmbientConsent();
		this.store = store;
		this.cleanups.push(store.subscribe(() => this.apply()));
		this.cleanups.push(() => this.removeClones());
		this.apply();
	}

	protected update(): void {
		this.apply();
	}

	private category(): OptionalConsentCategory | null {
		const raw = this.attr("category");
		return raw === "analytics" || raw === "marketing" ? raw : null;
	}

	private template(): HTMLTemplateElement | null {
		for (const child of Array.from(this.children)) {
			if (child instanceof HTMLTemplateElement) return child;
		}
		return null;
	}

	private placeholders(): HTMLElement[] {
		const clones = new Set<Node>(this.clones);
		return Array.from(this.children).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!(child instanceof HTMLTemplateElement) &&
				!clones.has(child),
		);
	}

	private apply(): void {
		const category = this.category();
		if (!category) {
			this.removeClones();
			this.fail(
				new Error(
					`shopkit: <qb-consent-gate> needs category="analytics" or ` +
						`category="marketing"; got ${JSON.stringify(this.attr("category") ?? "")}.`,
				),
				"<qb-consent-gate> has no valid category",
			);
			return;
		}
		const allowed = this.store?.allows(category) ?? false;
		this.setAttribute("state", allowed ? "granted" : "denied");

		if (!allowed) {
			this.removeClones();
			for (const placeholder of this.placeholders()) placeholder.hidden = false;
			return;
		}

		if (this.clones.length === 0) {
			const template = this.template();
			if (!template) {
				if (!this.warnedAboutTemplate) {
					this.warnedAboutTemplate = true;
					console.warn(
						"shopkit: <qb-consent-gate> has no <template> child, so there is " +
							"nothing to show once consent is granted.",
					);
				}
				return;
			}
			const fragment = template.content.cloneNode(true) as DocumentFragment;
			this.clones = Array.from(fragment.childNodes);
			// The placeholder keeps its place in the layout; content goes after it.
			for (const placeholder of this.placeholders()) placeholder.hidden = true;
			this.append(fragment);
		} else {
			for (const placeholder of this.placeholders()) placeholder.hidden = true;
		}
	}

	private removeClones(): void {
		for (const node of this.clones.splice(0)) node.remove();
	}
}
