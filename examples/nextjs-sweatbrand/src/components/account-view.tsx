"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { SEO, useCustomer, useCustomerClub } from "@quickbutik/kit/react";
import { clubJoinHint } from "@/lib/customer-club";
import { customerErrorMessage } from "@/lib/customer-errors";
import { useHydrated } from "@/lib/use-hydrated";
import AccountLayout, { AccountLoading } from "./account-layout";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";

export function AccountsClosed() {
  const { t, href } = usePreferences();
  return (
    <AccountLayout mode="closed">
      <div className="account-closed">
        <h1>{t("ACCOUNTS ARE ON THEIR WAY.")}</h1>
        <p>
          {t(
            "Customer accounts and the Everyday Club open soon. Until then, you can shop and check out as a guest.",
          )}
        </p>
        <Link className="button button-dark" href={href("/#shop")}>
          {t("EXPLORE ALL ESSENTIALS ")}
          <Icon name="arrow" />
        </Link>
      </div>
    </AccountLayout>
  );
}

export default function AccountView() {
  const { t } = usePreferences();
  const { catalog } = useStore();
  const hydrated = useHydrated();
  const { isLoggedIn } = useCustomer();
  const { login: loginSettings } = catalog.accounts;

  let content;
  if (!loginSettings.enabled) content = <AccountsClosed />;
  else if (!hydrated)
    content = (
      <AccountLayout mode="login">
        <AccountLoading />
      </AccountLayout>
    );
  else content = isLoggedIn ? <AccountOverview /> : <LoginForm />;

  return (
    <section className="shop-section account-page" aria-label={t("Account")}>
      <SEO title={t("Account")} noIndex />
      {content}
    </section>
  );
}

function LoginForm() {
  const { t, href } = usePreferences();
  const { login, loading, error } = useCustomer();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // The error is also on `error`; the form shows it from there.
    login({
      email: String(form.get("email")),
      password: String(form.get("password")),
    }).catch(() => undefined);
  }

  return (
    <AccountLayout mode="login">
      <div className="account-heading">
        <p className="eyebrow">
          <span className="mini-square" />
          {t(" YOUR ACCOUNT")}
        </p>
        <h1>{t("WELCOME BACK.")}</h1>
        <p className="account-intro">
          {t("Log in and pick up where you left off.")}
        </p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <label htmlFor="account-email">{t("Email")}</label>
        <input
          id="account-email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <div className="account-password-field">
          <label htmlFor="account-password">{t("Password")}</label>
          <input
            id="account-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Link href={href("/forgot-password")}>
            {t("Forgot your password?")}
          </Link>
        </div>
        <p className="account-error" role="alert">
          {error &&
            t(
              customerErrorMessage(
                error,
                "We couldn’t log you in. Please try again.",
              ),
            )}
        </p>
        <button className="button button-dark" type="submit" disabled={loading}>
          {t(loading ? "LOGGING IN…" : "LOG IN ")}
          <Icon name="arrow" />
        </button>
      </form>
    </AccountLayout>
  );
}

function AccountOverview() {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const { customer, logout, loading } = useCustomer();
  const address = customer?.address;
  return (
    <AccountLayout
      mode="overview"
      aside={catalog.accounts.customerClub.enabled ? <ClubCard /> : undefined}
    >
      <div className="account-heading">
        <p className="eyebrow">
          <span className="mini-square" />
          {t(" YOUR ACCOUNT")}
        </p>
        <h1>
          {customer?.firstName
            ? t("HI, {name}.", { name: customer.firstName.toUpperCase() })
            : t("WELCOME BACK.")}
        </h1>
        <p className="account-intro">
          {t("A little space for your everyday.")}
        </p>
      </div>
      <div className="account-details-heading">
        <Icon name="user" size={18} />
        <h2>{t("Your details")}</h2>
      </div>
      {customer && (
        <dl className="account-details">
          <div>
            <dt>{t("Name")}</dt>
            <dd>
              {[customer.firstName, customer.lastName]
                .filter(Boolean)
                .join(" ") || "—"}
            </dd>
          </div>
          <div>
            <dt>{t("Email")}</dt>
            <dd>{customer.email}</dd>
          </div>
          {customer.phone && (
            <div>
              <dt>{t("Phone")}</dt>
              <dd>{customer.phone}</dd>
            </div>
          )}
          {address && (address.line1 || address.city) && (
            <div>
              <dt>{t("Address")}</dt>
              <dd>
                {[
                  address.line1,
                  address.line2,
                  [address.postalCode, address.city].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .map((line) => (
                    <span key={line}>{line}</span>
                  ))}
              </dd>
            </div>
          )}
        </dl>
      )}
      <Link className="account-saved-link" href={href("/saved")}>
        <Icon name="heart" size={18} />
        <span>{t("Saved")}</span>
        <Icon name="arrow" size={18} />
      </Link>
      <div className="account-overview-footer">
        <Link href={href("/forgot-password")}>{t("Reset your password")}</Link>
        <button
          className="continue-button account-logout"
          onClick={() => void logout()}
          disabled={loading}
        >
          {t("Log out")}
        </button>
      </div>
    </AccountLayout>
  );
}

function ClubCard() {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const { data: club, loading } = useCustomerClub();
  if (loading && !club)
    return (
      <aside className="account-card club-card" aria-busy>
        <AccountLoading />
      </aside>
    );
  if (!club?.member)
    return (
      <aside className="account-card club-card">
        <div className="club-card-heading">
          <span className="eyebrow">{t("THE EVERYDAY CLUB")}</span>
          <Icon name="spark" size={32} />
        </div>
        <h2>{t("You’re not a member yet.")}</h2>
        <p>{t(clubJoinHint[catalog.accounts.customerClub.joinMethod])}</p>
        <Link className="text-link" href={href("/club")}>
          {t("DISCOVER THE CLUB ")}
          <Icon name="arrow" size={18} />
        </Link>
      </aside>
    );
  const { balance, lifetime } = club.points;
  const { targetPoints, remaining } = club.reward;
  const progress =
    targetPoints > 0
      ? Math.min(100, ((targetPoints - remaining) / targetPoints) * 100)
      : 0;
  return (
    <aside className="account-card club-card">
      <div className="club-card-heading">
        <span className="eyebrow">{t("THE EVERYDAY CLUB")}</span>
        <Icon name="spark" size={32} />
      </div>
      <p className="club-balance">
        <strong>{balance}</strong> {t(balance === 1 ? "point" : "points")}
      </p>
      {targetPoints > 0 && (
        <>
          <p className="club-progress-label">
            {t("Points to your next reward")}
          </p>
          <div
            className="club-progress"
            role="progressbar"
            aria-label={t("Points to your next reward")}
            aria-valuemin={0}
            aria-valuemax={targetPoints}
            aria-valuenow={targetPoints - remaining}
          >
            <i style={{ width: `${progress}%` }} />
          </div>
          <p>
            {t(
              remaining === 1
                ? "1 point to your next reward. It arrives as a code in your inbox."
                : "{remaining} points to your next reward. It arrives as a code in your inbox.",
              { remaining },
            )}
          </p>
        </>
      )}
      <p className="club-meta">
        {t(
          club.earning.pointsPerUnit === 1
            ? "You earn 1 point per {currency}."
            : "You earn {points} points per {currency}.",
          {
            points: club.earning.pointsPerUnit,
            currency: club.earning.currency,
          },
        )}{" "}
        {t(
          lifetime === 1
            ? "1 point earned in total."
            : "{count} points earned in total.",
          { count: lifetime },
        )}
      </p>
      <Link className="text-link" href={href("/club")}>
        {t("YOUR CLUB ACCOUNT ")}
        <Icon name="arrow" size={18} />
      </Link>
    </aside>
  );
}
