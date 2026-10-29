"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SEO, useCustomer } from "@quickbutik/kit/react";
import { customerErrorMessage } from "@/lib/customer-errors";
import AccountLayout from "./account-layout";
import { AccountsClosed } from "./account-view";
import Icon from "./icons";
import ResetCodeForm from "./reset-code-form";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function ForgotPasswordView() {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const { requestPasswordReset, loading, error } = useCustomer();
  const [email, setEmail] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email"));
    // Resolves the same whether or not the account exists.
    await requestPasswordReset({ email: address.trim() })
      .then(() => setEmail(address.trim()))
      .catch(() => undefined);
  }

  return (
    <section
      className="shop-section account-page"
      aria-label={t("Reset your password")}
    >
      <SEO title={t("Reset your password")} noIndex />
      {!catalog.accounts.login.enabled ? (
        <AccountsClosed />
      ) : (
        <AccountLayout mode="reset">
          <div className="account-heading">
            <p className="eyebrow">
              <span className="mini-square" />
              {t(" YOUR ACCOUNT")}
            </p>
            <h1>{t("RESET YOUR PASSWORD.")}</h1>
          </div>
          {email ? (
            <ResetCodeForm
              email={email}
              intro={t(
                "If there’s an account for {email}, we’ve emailed it a code. It works for 30 minutes.",
                { email },
              )}
            />
          ) : (
            <form className="account-form" onSubmit={submit}>
              <p className="account-intro">
                {t(
                  "Enter your email and we’ll send you a code to set a new password.",
                )}
              </p>
              <label htmlFor="forgot-email">{t("Email")}</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
              <p className="account-error" role="alert">
                {error &&
                  t(
                    customerErrorMessage(
                      error,
                      "Something went wrong. Please try again.",
                    ),
                  )}
              </p>
              <button
                className="button button-dark"
                type="submit"
                disabled={loading}
              >
                {t(loading ? "SENDING…" : "SEND CODE ")}
                <Icon name="arrow" />
              </button>
            </form>
          )}
          <div className="account-links">
            <Link href={href("/account")}>{t("Back to log in")}</Link>
          </div>
        </AccountLayout>
      )}
    </section>
  );
}
