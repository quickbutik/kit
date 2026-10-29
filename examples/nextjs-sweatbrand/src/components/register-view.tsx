"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SEO, useCustomer } from "@quickbutik/kit/react";
import { customerErrorMessage, isValidPassword } from "@/lib/customer-errors";
import { useHydrated } from "@/lib/use-hydrated";
import AccountLayout, { AccountLoading } from "./account-layout";
import { AccountsClosed } from "./account-view";
import Icon from "./icons";
import ResetCodeForm from "./reset-code-form";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export default function RegisterView() {
  const { t } = usePreferences();
  const { catalog } = useStore();
  const hydrated = useHydrated();
  const { isLoggedIn } = useCustomer();
  const { login } = catalog.accounts;

  let content;
  if (!login.enabled) content = <AccountsClosed />;
  else if (!hydrated)
    content = (
      <AccountLayout mode="register">
        <AccountLoading />
      </AccountLayout>
    );
  else if (isLoggedIn) content = <AlreadyMember />;
  else content = <SignUp />;

  return (
    <section
      className="shop-section account-page"
      aria-label={t("Create an account")}
    >
      <SEO title={t("Create an account")} noIndex />
      {content}
    </section>
  );
}

function SignUp() {
  const { t, href } = usePreferences();
  const router = useRouter();
  const { catalog } = useStore();
  const { register, loading, error } = useCustomer();
  const { login, customerClub } = catalog.accounts;
  const [weakPassword, setWeakPassword] = useState(false);
  // An email that has ordered as a guest: finished with an emailed code.
  const [verify, setVerify] = useState<{ email: string; password: string }>();
  const [loginRequired, setLoginRequired] = useState(false);
  // clubOptIn only counts where the club takes members at registration.
  const clubAtSignUp =
    customerClub.enabled &&
    (customerClub.joinMethod === "registration" ||
      customerClub.joinMethod === "auto_and_registration");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    setWeakPassword(!isValidPassword(password));
    if (!isValidPassword(password)) return;
    const result = await register({
      email,
      password,
      firstName: String(form.get("firstName")).trim(),
      lastName: String(form.get("lastName")).trim(),
      clubOptIn: clubAtSignUp && form.get("clubOptIn") === "on",
    }).catch(() => null);
    if (result?.status === "logged_in") router.push(href("/account"));
    if (result?.status === "verification_required")
      setVerify({ email, password });
    if (result?.status === "login_required") setLoginRequired(true);
  }

  let body;
  if (!login.signupAllowed)
    body = (
      <p className="account-intro">
        {t(
          "Sign-ups aren’t open yet. Until then, you can shop and check out as a guest.",
        )}
      </p>
    );
  else if (verify)
    body = (
      <ResetCodeForm
        email={verify.email}
        password={verify.password}
        intro={t(
          "If you’ve ordered with us before, we’ve emailed you a code. Enter it to finish creating your account.",
        )}
      />
    );
  else if (loginRequired)
    body = (
      <>
        <p className="account-intro">
          {t("Your account is ready. Log in with your email and password.")}
        </p>
        <Link
          className="button button-dark account-cta"
          href={href("/account")}
        >
          {t("LOG IN ")}
          <Icon name="arrow" />
        </Link>
      </>
    );
  else
    body = (
      <form className="account-form" onSubmit={submit}>
        <div className="account-name-row">
          <div>
            <label htmlFor="register-first-name">{t("First name")}</label>
            <input
              id="register-first-name"
              name="firstName"
              autoComplete="given-name"
              required
            />
          </div>
          <div>
            <label htmlFor="register-last-name">{t("Last name")}</label>
            <input
              id="register-last-name"
              name="lastName"
              autoComplete="family-name"
              required
            />
          </div>
        </div>
        <label htmlFor="register-email">{t("Email")}</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <label htmlFor="register-password">{t("Password")}</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="register-password-hint"
          required
        />
        <p className="account-hint" id="register-password-hint">
          {t("6 to 40 characters.")}
        </p>
        {clubAtSignUp && (
          <label className="account-checkbox">
            <input type="checkbox" name="clubOptIn" />
            <span>
              {t(
                "Join the Everyday Club: earn points on your purchases and get reward codes by email.",
              )}
            </span>
          </label>
        )}
        <p className="account-error" role="alert">
          {weakPassword
            ? t("Use a password of 6 to 40 characters.")
            : error
              ? t(
                  customerErrorMessage(
                    error,
                    "We couldn’t create your account. Please try again.",
                  ),
                )
              : ""}
        </p>
        <button className="button button-dark" type="submit" disabled={loading}>
          {t(loading ? "CREATING ACCOUNT…" : "CREATE ACCOUNT ")}
          <Icon name="arrow" />
        </button>
        <p className="account-hint">
          {t("We use your details to run your account.")}{" "}
          <Link href={href("/privacy")}>{t("Privacy")}</Link>
        </p>
      </form>
    );

  return (
    <AccountLayout mode="register">
      <div className="account-heading">
        <p className="eyebrow">
          <span className="mini-square" />
          {t(customerClub.enabled ? " THE EVERYDAY CLUB" : " YOUR ACCOUNT")}
        </p>
        <h1>
          {t(
            customerClub.enabled
              ? "JOIN THE EVERYDAY CLUB."
              : "CREATE YOUR ACCOUNT.",
          )}
        </h1>
        {!verify && !loginRequired && login.signupAllowed && (
          <p className="account-intro">
            {t("Make yourself at home. Start with a few details.")}
          </p>
        )}
      </div>
      {body}
      {!login.signupAllowed && (
        <div className="account-links">
          <Link href={href("/account")}>{t("Back to log in")}</Link>
        </div>
      )}
    </AccountLayout>
  );
}

function AlreadyMember() {
  const { t, href } = usePreferences();
  return (
    <AccountLayout mode="overview">
      <div className="account-closed">
        <h1>{t("YOU’RE ALREADY IN.")}</h1>
        <p>{t("You’re logged in, so there’s nothing more to sign up for.")}</p>
        <Link className="button button-dark" href={href("/account")}>
          {t("YOUR CLUB ACCOUNT ")}
          <Icon name="arrow" />
        </Link>
      </div>
    </AccountLayout>
  );
}
