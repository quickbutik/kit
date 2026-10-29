"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "./icons";
import Logo from "./logo";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";
import "./account.css";

type AccountMode = "login" | "register" | "reset" | "overview" | "closed";

export default function AccountLayout({
  mode,
  children,
  aside,
}: {
  mode: AccountMode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const showTabs =
    (mode === "login" || mode === "register") &&
    catalog.accounts.login.signupAllowed;

  return (
    <div className="account-container">
      <div className="account-toolbar">
        <Link className="account-back" href={href("/#shop")}>
          <Icon name="arrow" size={16} />
          {t("Back to shop")}
        </Link>
      </div>
      <div className="account-layout">
        <div className="account-main">
          {showTabs && (
            <nav className="account-tabs" aria-label={t("Account options")}>
              <Link
                href={href("/account")}
                aria-current={mode === "login" ? "page" : undefined}
              >
                {t("Log in")}
              </Link>
              <Link
                href={href("/register")}
                aria-current={mode === "register" ? "page" : undefined}
              >
                {t("Create an account")}
              </Link>
            </nav>
          )}
          {children}
        </div>
        {aside ?? <AccountCompanion />}
      </div>
    </div>
  );
}

function AccountCompanion() {
  const { t } = usePreferences();
  const { catalog } = useStore();
  const clubEnabled =
    catalog.accounts.login.enabled && catalog.accounts.customerClub.enabled;

  return (
    <aside className="account-companion">
      <div className="account-club-art" aria-hidden="true">
        <Logo className="account-club-logo" />
        <div className="account-club-type">
          {clubEnabled ? (
            <>
              <span>{t("EVERYDAY")}</span>
              <span>{t("CLUB")}</span>
            </>
          ) : (
            <span>{t("MADE FOR YOUR EVERYDAY.")}</span>
          )}
          <Icon name="spark" size={80} />
        </div>
        <span className="account-club-caption">{t("ALL PACES WELCOME.")}</span>
      </div>
      <div className="account-companion-copy">
        <h2>
          {t(
            clubEnabled ? "Every purchase counts." : "Made for your everyday.",
          )}
        </h2>
        {clubEnabled ? (
          <ul className="club-benefits">
            {[
              "Earn points on everything you buy.",
              "Reach the goal and a reward code lands in your inbox.",
              "Follow your points on your account page.",
            ].map((benefit) => (
              <li key={benefit}>
                <Icon name="check" size={16} />
                <span>{t(benefit)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("From the warm-up to the wind-down")}</p>
        )}
      </div>
    </aside>
  );
}

export function AccountLoading() {
  const { t } = usePreferences();
  return (
    <div className="account-loading" role="status" aria-busy="true">
      <span className="sr-only">{t("Loading your account")}</span>
      <div className="account-loading-heading" />
      <div className="account-loading-field" />
      <div className="account-loading-field" />
      <div className="account-loading-button" />
    </div>
  );
}
