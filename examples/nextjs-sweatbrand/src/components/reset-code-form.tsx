"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShopkitAuthError } from "@quickbutik/kit";
import { useCustomer } from "@quickbutik/kit/react";
import { customerErrorMessage, isValidPassword } from "@/lib/customer-errors";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";

// The second step of a password reset, and of registering an email that has
// ordered as a guest: the shopper types the emailed code, and resetPassword()
// sets the password and logs them in. Without `password`, it asks for a new one.
export default function ResetCodeForm({
  email,
  password,
  intro,
}: {
  email: string;
  password?: string;
  intro: string;
}) {
  const { t, href } = usePreferences();
  const router = useRouter();
  const { resetPassword, requestPasswordReset, loading, error } = useCustomer();
  const [weakPassword, setWeakPassword] = useState(false);
  const [resent, setResent] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = password ?? String(form.get("password"));
    setWeakPassword(!isValidPassword(newPassword));
    if (!isValidPassword(newPassword)) return;
    setResent(false);
    try {
      await resetPassword({
        email,
        code: String(form.get("code")),
        password: newPassword,
      });
      router.push(href("/account"));
    } catch (cause) {
      // Rare: the password changed but no session opened. It works, so log in.
      if (
        cause instanceof ShopkitAuthError &&
        cause.code === "password_changed_login_required"
      )
        setLoginRequired(true);
    }
  }

  async function resend() {
    setResent(false);
    await requestPasswordReset({ email })
      .then(() => setResent(true))
      .catch(() => undefined);
  }

  if (loginRequired)
    return (
      <div>
        <p className="account-intro">
          {t("Your password is changed. Log in with your new password.")}
        </p>
        <Link
          className="button button-dark account-cta"
          href={href("/account")}
        >
          {t("LOG IN ")}
          <Icon name="arrow" />
        </Link>
      </div>
    );

  return (
    <form className="account-form" onSubmit={submit}>
      <p className="account-intro">{intro}</p>
      <label htmlFor="reset-code">{t("Code")}</label>
      <input
        id="reset-code"
        name="code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      {password === undefined && (
        <>
          <label htmlFor="reset-password">{t("New password")}</label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-describedby="reset-password-hint"
            required
          />
          <p className="account-hint" id="reset-password-hint">
            {t("6 to 40 characters.")}
          </p>
        </>
      )}
      <p className="account-error" role="alert">
        {weakPassword
          ? t("Use a password of 6 to 40 characters.")
          : error
            ? t(
                customerErrorMessage(
                  error,
                  "Something went wrong. Please try again.",
                ),
              )
            : ""}
      </p>
      <p className="account-status" role="status">
        {resent && t("We’ve sent a new code.")}
      </p>
      <button className="button button-dark" type="submit" disabled={loading}>
        {t(loading ? "CONFIRMING…" : "CONFIRM ")}
        <Icon name="arrow" />
      </button>
      <button
        className="continue-button account-resend"
        type="button"
        onClick={resend}
        disabled={loading}
      >
        {t("Send a new code")}
      </button>
    </form>
  );
}
