/**
 * The default banner's stylesheet, shared by `<ConsentBanner>` and
 * `<qb-consent-banner>`.
 *
 * - Everything sits in `@layer qb-consent`, so any unlayered site rule for a
 *   `.qb-consent*` class wins without `!important`.
 * - Customise via custom properties on `:root` or the banner:
 *   `--qb-consent-bg`, `-fg`, `-muted`, `-border`, `-accent`, `-accent-fg`,
 *   `-radius`, `-button-radius`, `-font`, `-font-size`, `-padding`, `-gap`,
 *   `-offset`, `-max-width`, `-shadow`, `-focus`, `-z-index`. Built-in
 *   colours follow `prefers-color-scheme`; a colour you set applies to both.
 * - `qb-consent--unstyled` (the `unstyled` prop / attribute) opts out.
 *
 * Accept and reject share one look on purpose: EU regulators object to an
 * "accept all" more prominent than "only necessary".
 */
export const CONSENT_STYLE_ID = "qb-consent-styles";

const S = ".qb-consent:not(.qb-consent--unstyled)";

export const CONSENT_STYLES =
	`@layer qb-consent{${S}{--_bg:var(--qb-consent-bg,#fff);--_fg:var(--qb-consent-fg,#1c1b1a);--_muted:var(--qb-consent-muted,#5f5b57);--_border:var(--qb-consent-border,#dedad4);--_accent:var(--qb-consent-accent,#1c1b1a);--_accent-fg:var(--qb-consent-accent-fg,#fff);position:fixed;z-index:var(--qb-consent-z-index,9999);inset:auto var(--qb-consent-offset,16px) var(--qb-consent-offset,16px);box-sizing:border-box;max-width:var(--qb-consent-max-width,560px);max-height:calc(100vh - 2*var(--qb-consent-offset,16px));overflow:auto;margin:0 0 0 auto;padding:var(--qb-consent-padding,20px);background:var(--_bg);color:var(--_fg);border:1px solid var(--_border);border-radius:var(--qb-consent-radius,12px);box-shadow:var(--qb-consent-shadow,0 12px 40px rgb(0 0 0/.16));font-family:var(--qb-consent-font,inherit);font-size:var(--qb-consent-font-size,14px);line-height:1.5;text-align:start}` +
	`${S} *{box-sizing:border-box}` +
	`${S} .qb-consent__title{margin:0 0 6px;font:inherit;font-size:1.15em;font-weight:650;line-height:1.3;color:inherit}` +
	`${S} .qb-consent__description{margin:0;color:var(--_muted)}` +
	`${S} .qb-consent__policy{color:inherit;text-decoration:underline;text-underline-offset:3px}` +
	`${S} .qb-consent__categories{min-width:0;margin:14px 0 0;padding:0;border:0;display:grid;gap:10px}` +
	`${S} .qb-consent__category{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:baseline;cursor:pointer}` +
	`${S} .qb-consent__category input{width:16px;height:16px;margin:0;accent-color:var(--_accent)}` +
	`${S} .qb-consent__category-name{font-weight:600}` +
	`${S} .qb-consent__category-description{grid-column:2;color:var(--_muted);font-size:.93em}` +
	`${S} .qb-consent__actions{display:flex;flex-wrap:wrap;gap:var(--qb-consent-gap,8px);justify-content:flex-end;margin-top:16px}` +
	`${S} .qb-consent__button{min-height:40px;padding:9px 16px;font:inherit;font-weight:550;line-height:1.2;color:inherit;background:transparent;border:1px solid var(--_border);border-radius:var(--qb-consent-button-radius,8px);cursor:pointer}` +
	`${S} .qb-consent__button:hover{border-color:currentColor}` +
	`${S} :is(.qb-consent__button--accept,.qb-consent__button--reject,.qb-consent__button--save){color:var(--_accent-fg);background:var(--_accent);border-color:var(--_accent)}` +
	`${S} :is(.qb-consent__button--accept,.qb-consent__button--reject,.qb-consent__button--save):hover{opacity:.88}` +
	`${S} :is(.qb-consent__button,.qb-consent__policy,input):focus-visible{outline:2px solid var(--qb-consent-focus,var(--_accent));outline-offset:2px}` +
	`@media (prefers-color-scheme:dark){${S}{--_bg:var(--qb-consent-bg,#1f1e1d);--_fg:var(--qb-consent-fg,#f3f1ee);--_muted:var(--qb-consent-muted,#b3aea8);--_border:var(--qb-consent-border,#3d3a37);--_accent:var(--qb-consent-accent,#f3f1ee);--_accent-fg:var(--qb-consent-accent-fg,#1c1b1a)}}` +
	`@media (max-width:600px){${S}{inset:auto 0 0;max-width:none;border-width:1px 0 0;border-radius:var(--qb-consent-radius,12px) var(--qb-consent-radius,12px) 0 0}${S} .qb-consent__button{flex:1 1 auto}}}`;

/**
 * Put the default banner's stylesheet in `<head>`, once per document; a
 * no-op outside a browser. The React banner renders its own `<style>` and
 * does not need this.
 */
export function injectConsentStyles(doc?: Document): void {
	const target = doc ?? (typeof document !== "undefined" ? document : null);
	if (!target || target.getElementById(CONSENT_STYLE_ID)) return;
	const style = target.createElement("style");
	style.id = CONSENT_STYLE_ID;
	style.textContent = CONSENT_STYLES;
	(target.head ?? target.documentElement).append(style);
}
