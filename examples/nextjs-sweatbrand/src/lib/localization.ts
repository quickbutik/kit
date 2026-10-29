import { messages } from "./translations";

export type Language = "sv" | "dk" | "no" | "en";
export type Preferences = { language: Language };

export const languages = [
  { code: "sv", name: "Svenska", locale: "sv-SE", htmlLang: "sv" },
  { code: "dk", name: "Dansk", locale: "da-DK", htmlLang: "da" },
  { code: "no", name: "Norsk", locale: "nb-NO", htmlLang: "nb" },
  { code: "en", name: "English", locale: "en-GB", htmlLang: "en" },
] as const;

export const defaultPreferences: Preferences = { language: "en" };

// The language lives in the first path segment, e.g. /sv-SE/products/...
export function localePath(language: Language, path: string) {
  const { locale } = languages.find((item) => item.code === language)!;
  return `/${locale}${path.replace(/^\/(?=$|#)/, "")}`;
}

// Picks a language for visitors arriving without one in the URL.
export function preferredLanguage(acceptLanguage: string): Language {
  const requested = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((item) => item.trim().startsWith("q="));
      return { tag, quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const { tag } of requested) {
    const base = tag.split("-")[0];
    const match = languages.find(
      (item) =>
        item.locale.toLowerCase() === tag ||
        item.htmlLang === (base === "no" || base === "nn" ? "nb" : base),
    );
    if (match) return match.code;
  }
  return defaultPreferences.language;
}

// Quickbutik amounts are integers in minor units (24900 is 249.00) in the
// currency the API states. Whole amounts drop the decimals.
export function formatPrice(
  amount: number,
  currency: string,
  language: Language,
) {
  const { locale } = languages.find((item) => item.code === language)!;
  const decimals = amount % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: currency === "EUR" ? "symbol" : "code",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 100);
}

const translations = new Map(
  messages.map(([source, ...translated]) => [source, translated]),
);
const languageIndex = { sv: 0, dk: 1, no: 2 } as const;

export function translate(
  text: string,
  language: Language,
  values: Record<string, string | number> = {},
) {
  const source = text.trim();
  const translated =
    language === "en"
      ? source
      : (translations.get(source)?.[languageIndex[language]] ?? source);
  const padded =
    text.slice(0, text.indexOf(source)) +
    translated +
    text.slice(text.indexOf(source) + source.length);
  return padded.replace(/\{(\w+)\}/g, (match, key: string) =>
    String(values[key] ?? match),
  );
}
