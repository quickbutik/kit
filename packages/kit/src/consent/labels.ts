/**
 * The text of the default dialog `<ConsentBanner>` and `<qb-consent-banner>`
 * render when given no content. Every string can be overridden via `labels`.
 */
export interface ConsentLabels {
	title: string;
	description: string;
	acceptAll: string;
	rejectAll: string;
	settings: string;
	save: string;
	close: string;
	necessary: string;
	necessaryDescription: string;
	analytics: string;
	analyticsDescription: string;
	marketing: string;
	marketingDescription: string;
	privacyPolicy: string;
	/** The footer button that reopens the banner (`<ConsentSettingsButton>`). */
	cookieSettings: string;
}

const EN: ConsentLabels = {
	title: "We use cookies",
	description:
		"We use cookies to make the site work, to understand how it is used and to show relevant marketing. You choose what to allow.",
	acceptAll: "Accept all",
	rejectAll: "Only necessary",
	settings: "Settings",
	save: "Save choices",
	close: "Close",
	necessary: "Necessary",
	necessaryDescription:
		"Required for the site and the cart to work. Cannot be switched off.",
	analytics: "Analytics and performance",
	analyticsDescription:
		"Helps us understand how the site is used so we can improve it.",
	marketing: "Marketing",
	marketingDescription: "Used to show relevant ads and measure campaigns.",
	privacyPolicy: "Privacy policy",
	cookieSettings: "Cookie settings",
};

const SV: ConsentLabels = {
	title: "Vi använder cookies",
	description:
		"Vi använder cookies för att webbplatsen ska fungera, för att förstå hur den används och för att visa relevant marknadsföring. Du väljer själv vad du tillåter.",
	acceptAll: "Godkänn alla",
	rejectAll: "Endast nödvändiga",
	settings: "Inställningar",
	save: "Spara val",
	close: "Stäng",
	necessary: "Nödvändiga",
	necessaryDescription:
		"Krävs för att webbplatsen och varukorgen ska fungera. Kan inte stängas av.",
	analytics: "Analys och prestanda",
	analyticsDescription:
		"Hjälper oss förstå hur webbplatsen används så att vi kan förbättra den.",
	marketing: "Marknadsföring",
	marketingDescription:
		"Används för att visa relevanta annonser och mäta kampanjer.",
	privacyPolicy: "Integritetspolicy",
	cookieSettings: "Cookie-inställningar",
};

const DA: ConsentLabels = {
	title: "Vi bruger cookies",
	description:
		"Vi bruger cookies for at få hjemmesiden til at fungere, forstå hvordan den bruges og vise relevant markedsføring. Du vælger selv, hvad du tillader.",
	acceptAll: "Accepter alle",
	rejectAll: "Kun nødvendige",
	settings: "Indstillinger",
	save: "Gem valg",
	close: "Luk",
	necessary: "Nødvendige",
	necessaryDescription:
		"Kræves for at hjemmesiden og indkøbskurven fungerer. Kan ikke slås fra.",
	analytics: "Analyse og ydeevne",
	analyticsDescription:
		"Hjælper os med at forstå, hvordan hjemmesiden bruges, så vi kan forbedre den.",
	marketing: "Markedsføring",
	marketingDescription:
		"Bruges til at vise relevante annoncer og måle kampagner.",
	privacyPolicy: "Privatlivspolitik",
	cookieSettings: "Cookie-indstillinger",
};

const NB: ConsentLabels = {
	title: "Vi bruker informasjonskapsler",
	description:
		"Vi bruker informasjonskapsler for at nettstedet skal fungere, for å forstå hvordan det brukes og for å vise relevant markedsføring. Du velger selv hva du tillater.",
	acceptAll: "Godta alle",
	rejectAll: "Kun nødvendige",
	settings: "Innstillinger",
	save: "Lagre valg",
	close: "Lukk",
	necessary: "Nødvendige",
	necessaryDescription:
		"Kreves for at nettstedet og handlekurven skal fungere. Kan ikke slås av.",
	analytics: "Analyse og ytelse",
	analyticsDescription:
		"Hjelper oss å forstå hvordan nettstedet brukes, slik at vi kan forbedre det.",
	marketing: "Markedsføring",
	marketingDescription:
		"Brukes til å vise relevante annonser og måle kampanjer.",
	privacyPolicy: "Personvernerklæring",
	cookieSettings: "Innstillinger for informasjonskapsler",
};

const FI: ConsentLabels = {
	title: "Käytämme evästeitä",
	description:
		"Käytämme evästeitä, jotta sivusto toimii, jotta ymmärrämme miten sitä käytetään ja jotta voimme näyttää osuvaa markkinointia. Valitset itse, mitä sallit.",
	acceptAll: "Hyväksy kaikki",
	rejectAll: "Vain välttämättömät",
	settings: "Asetukset",
	save: "Tallenna valinnat",
	close: "Sulje",
	necessary: "Välttämättömät",
	necessaryDescription:
		"Tarvitaan sivuston ja ostoskorin toimintaan. Ei voi poistaa käytöstä.",
	analytics: "Analytiikka ja suorituskyky",
	analyticsDescription:
		"Auttaa meitä ymmärtämään, miten sivustoa käytetään, jotta voimme parantaa sitä.",
	marketing: "Markkinointi",
	marketingDescription:
		"Käytetään osuvien mainosten näyttämiseen ja kampanjoiden mittaamiseen.",
	privacyPolicy: "Tietosuojaseloste",
	cookieSettings: "Evästeasetukset",
};

const LABELS: Record<string, ConsentLabels> = {
	en: EN,
	sv: SV,
	da: DA,
	nb: NB,
	fi: FI,
};

/**
 * The labels for a language, with overrides applied.
 *
 * `lang` is a BCP 47 tag or a bare code; only the primary subtag matters
 * (`sv-SE` → `sv`), `no`/`nn` fold into `nb`, and anything unknown falls back
 * to English. Defaults to `<html lang>` in a browser.
 */
export function consentLabels(
	lang?: string | null,
	overrides?: Partial<ConsentLabels> | null,
): ConsentLabels {
	const base = LABELS[resolveLanguage(lang)] ?? EN;
	return overrides ? { ...base, ...compact(overrides) } : base;
}

/** The languages the default banner has copy for. */
export const CONSENT_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS);

export function resolveLanguage(lang?: string | null): string {
	const explicit = lang?.trim();
	const candidate =
		explicit ||
		(typeof document !== "undefined"
			? document.documentElement?.lang?.trim()
			: "") ||
		"en";
	const primary = candidate.toLowerCase().split(/[-_]/)[0] ?? "en";
	if (primary === "no" || primary === "nn") return "nb";
	// Own keys only, so `constructor` or `toString` never match.
	return Object.hasOwn(LABELS, primary) ? primary : "en";
}

/** Drop undefined overrides so they do not blank out a default. */
function compact(overrides: Partial<ConsentLabels>): Partial<ConsentLabels> {
	const out: Partial<ConsentLabels> = {};
	for (const [key, value] of Object.entries(overrides)) {
		if (typeof value === "string") {
			out[key as keyof ConsentLabels] = value;
		}
	}
	return out;
}
