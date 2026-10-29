import { Anton, Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import Storefront from "@/components/storefront";
import Logo from "@/components/logo";
import { languages, type Language } from "@/lib/localization";
import {
  clientConfig,
  getCatalog,
  requestCurrency,
  siteUrl,
  visitorState,
} from "@/lib/shopkit";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// No `metadata` export: every page renders the kit's <SEO />, which owns the
// title, canonical, OpenGraph and structured data.

export function generateStaticParams() {
  return languages.map((language) => ({ locale: language.locale }));
}

async function PersonalizedStore({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  // The catalog is cached per currency; cart and consent are the visitor's own.
  const currency = await requestCurrency();
  const [catalog, { cart, consent, signedIn }] = await Promise.all([
    getCatalog(currency),
    visitorState(),
  ]);
  return (
    <Storefront
      language={language}
      catalog={catalog}
      config={clientConfig()}
      currency={currency}
      initialCart={cart}
      consent={consent}
      signedIn={signedIn}
      siteUrl={siteUrl()}
    >
      {children}
    </Storefront>
  );
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  const language = languages.find((item) => item.locale === locale);
  if (!language) notFound();
  // Keep viewport snapshots enabled so a fade also preserves scrolled content.
  return (
    <html
      lang={language.htmlLang}
      data-scroll-behavior="smooth"
      style={{ viewTransitionName: "root" }}
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable}`}
    >
      <body>
        <Suspense
          fallback={
            <div
              className="storefront-loading"
              role="status"
              aria-label="Loading your store"
            >
              <Logo />
            </div>
          }
        >
          <PersonalizedStore language={language.code}>
            {children}
          </PersonalizedStore>
        </Suspense>
      </body>
    </html>
  );
}
