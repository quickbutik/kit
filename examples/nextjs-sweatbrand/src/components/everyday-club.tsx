"use client";

import Link from "next/link";
import Image from "next/image";
import type { PointerEvent } from "react";
import { SEO, useCustomer, useCustomerClub } from "@quickbutik/kit/react";
import { clubJoinHint } from "@/lib/customer-club";
import { useHydrated } from "@/lib/use-hydrated";
import Icon from "./icons";
import Logo from "./logo";
import ClubAtmosphere from "./club-atmosphere";
import { usePreferences } from "./store-preferences";
import { useStore } from "./store-context";
import "./everyday-club.css";

export default function EverydayClub() {
  const { t, href } = usePreferences();
  const { catalog } = useStore();
  const clubEnabled =
    catalog.accounts.login.enabled && catalog.accounts.customerClub.enabled;

  return (
    <div className="club-page">
      <SEO
        title={t("The everyday club")}
        description={t(
          "A little more from your everyday. Discover the Everyday Club, follow your points and get closer to your next reward.",
        )}
        url={href("/club")}
      />
      <section
        className="club-page-hero"
        aria-labelledby="everyday-club-heading"
      >
        <ClubAtmosphere paused={false} />
        <div className="club-page-hero-inner">
          <div className="club-page-overline">
            <span>
              <span className="club-page-status-dot" />
              SWEATBRAND / {t("THE EVERYDAY CLUB")}
            </span>
          </div>
          <div className="club-page-hero-grid">
            <div className="club-page-identity">
              <h1 id="everyday-club-heading">
                <span>{t("THE")}</span>
                <span className="club-page-outline">{t("EVERYDAY")}</span>
                <span className="club-page-last-line">
                  {t("CLUB")}
                  <span className="club-page-period">.</span>
                </span>
              </h1>
              <p className="club-page-identity-copy">
                {t(
                  "Good gear. Your kind of movement. A little more to look forward to.",
                )}
              </p>
            </div>
            <div className="club-page-access" id="club-access">
              {clubEnabled ? (
                <ClubAccess />
              ) : (
                <ClubComingSoon />
              )}
            </div>
          </div>
          <div className="club-page-hero-bottom">
            <span>{t("NOT JUST A WORKOUT. A WAY OF LIFE.")}</span>
            {clubEnabled && (
              <a href="#club-guide">
                {t("DISCOVER THE CLUB")}
                <Icon name="arrow" size={16} />
              </a>
            )}
          </div>
        </div>
      </section>

      {clubEnabled && <ClubGuide />}

      <section
        className="club-page-manifesto"
        aria-labelledby="club-manifesto-heading"
      >
        <Image
          src="/images/hero-women-gym.webp"
          alt=""
          fill
          sizes="100vw"
          className="club-page-manifesto-photo"
        />
        <div className="club-page-manifesto-content">
          <p className="eyebrow">{t("GOOD PEOPLE. GOOD MOVEMENT.")}</p>
          <h2 id="club-manifesto-heading">
            {t("YOU DON’T HAVE TO")}
            <br />
            {t("GO PRO. JUST GO.")}
          </h2>
          <p className="club-page-manifesto-copy">
            {t(
              "We’re here for the everyday athletes. The ones who show up, move a little, and make it their own. Good gear for whatever your kind of movement looks like.",
            )}
          </p>
        </div>
      </section>
    </div>
  );
}

function ClubAccess() {
  const { t } = usePreferences();
  const hydrated = useHydrated();
  const { isLoggedIn, loading, customer } = useCustomer();

  if (!hydrated || (loading && !customer)) return <ClubLoading />;
  if (isLoggedIn) return <ClubMember />;

  return (
    <>
      <MembershipPass />
      <div className="club-page-invitation-copy">
        <p className="eyebrow club-page-kicker">
          <span className="mini-square" />
          {t("YOUR EVERYDAY. REWARDED.")}
        </p>
        <h2>{t("Every purchase counts.")}</h2>
        <p className="club-page-description">
          {t("Earn points on everything you buy.")}{" "}
          {t("Reach the goal and a reward code lands in your inbox.")}
        </p>
        <ClubGuestActions />
      </div>
    </>
  );
}

function MembershipPass() {
  const { t } = usePreferences();

  function move(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    event.currentTarget.style.setProperty(
      "--pass-rotate-x",
      `${(0.5 - y) * 12}deg`,
    );
    event.currentTarget.style.setProperty(
      "--pass-rotate-y",
      `${(x - 0.5) * 16}deg`,
    );
    event.currentTarget.style.setProperty("--foil-x", `${x * 100}%`);
    event.currentTarget.style.setProperty("--foil-y", `${y * 100}%`);
  }

  function reset(event: PointerEvent<HTMLDivElement>) {
    for (const property of [
      "--pass-rotate-x",
      "--pass-rotate-y",
      "--foil-x",
      "--foil-y",
    ])
      event.currentTarget.style.removeProperty(property);
  }

  return (
    <div
      className="club-pass-stage"
      aria-hidden="true"
      onPointerMove={move}
      onPointerLeave={reset}
    >
      <div className="club-pass-float">
        <div className="club-pass">
          <div className="club-pass-top">
            <Logo />
            <span>S / E.C.</span>
          </div>
          <div className="club-pass-body">
            <p>
              {t("THE")}
              <br />
              {t("EVERYDAY")} {t("CLUB")}
            </p>
            <div className="club-pass-emblem">
              <span />
              <Icon name="spark" size={100} />
            </div>
          </div>
          <div className="club-pass-bottom">
            <span className="club-pass-chip" />
          </div>
          <div className="club-pass-foil" />
        </div>
      </div>
    </div>
  );
}

function ClubGuestActions() {
  const { t, href } = usePreferences();
  const { catalog, openInfo } = useStore();
  const { login, customerClub } = catalog.accounts;
  const registration =
    customerClub.joinMethod === "registration" ||
    customerClub.joinMethod === "auto_and_registration";

  return (
    <div className="club-page-actions">
      {customerClub.joinMethod === "manual" ? (
        <>
          <p className="club-page-note">{t(clubJoinHint.manual)}</p>
          <button
            className="button button-dark"
            onClick={() => openInfo("Contact")}
          >
            {t("Contact")}
            <Icon name="arrow" size={18} />
          </button>
        </>
      ) : login.signupAllowed ? (
        <>
          <Link className="button button-dark" href={href("/register")}>
            {t(registration ? "JOIN THE CLUB " : "Create an account")}
            <Icon name="arrow" size={18} />
          </Link>
          {!registration && (
            <p className="club-page-note">{t(clubJoinHint.auto)}</p>
          )}
        </>
      ) : (
        <p className="club-page-note">
          {t(
            "Sign-ups aren’t open yet. Until then, you can shop and check out as a guest.",
          )}
        </p>
      )}
      <Link className="club-page-login" href={href("/account")}>
        {t("Already a member? Log in")}
        <Icon name="arrow" size={16} />
      </Link>
    </div>
  );
}

function ClubMember() {
  const { t, href, htmlLang } = usePreferences();
  const { catalog, openInfo } = useStore();
  const { customer } = useCustomer();
  const { data: club, loading, error, refetch } = useCustomerClub();

  if (loading && !club) return <ClubLoading />;
  if (error || !club)
    return (
      <div className="club-page-message" role="alert">
        <p className="eyebrow">{t("THE EVERYDAY CLUB")}</p>
        <h2>{t("Your points will be right back.")}</h2>
        <p className="club-page-description">
          {t("We couldn’t load your club details. Please try again.")}
        </p>
        <button
          className="button button-dark"
          onClick={refetch}
          disabled={loading}
        >
          {t("Try again")}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    );

  if (!club.member)
    return (
      <>
        <p className="eyebrow club-page-kicker">
          <span className="mini-square" />
          {t("THE EVERYDAY CLUB")}
        </p>
        <h2>{t("You’re not a member yet.")}</h2>
        <p className="club-page-description">
          {t(clubJoinHint[catalog.accounts.customerClub.joinMethod])}
        </p>
        <div className="club-page-actions">
          {catalog.accounts.customerClub.joinMethod === "auto" ||
          catalog.accounts.customerClub.joinMethod ===
            "auto_and_registration" ? (
            <ShopLink />
          ) : (
            <button
              className="button button-dark"
              onClick={() => openInfo("Contact")}
            >
              {t("Contact")}
              <Icon name="arrow" size={18} />
            </button>
          )}
          <Link className="club-page-login" href={href("/account")}>
            {t("Your account")}
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </>
    );

  const number = new Intl.NumberFormat(htmlLang);
  const { balance, lifetime } = club.points;
  const { targetPoints, remaining } = club.reward;
  const earned = Math.max(0, Math.min(targetPoints, targetPoints - remaining));
  const progress = targetPoints > 0 ? (earned / targetPoints) * 100 : 0;

  return (
    <>
      <div className="club-page-member-heading">
        <p className="eyebrow club-page-kicker">
          <span className="mini-square" />
          {t("YOUR CLUB ACCOUNT")}
        </p>
        <button
          className="club-page-refresh"
          onClick={refetch}
          disabled={loading}
          aria-label={t("Refresh club points")}
        >
          {t(loading ? "Updating…" : "Refresh")}
        </button>
      </div>
      <h2 className="club-page-greeting">
        {customer?.firstName
          ? t("HI, {name}.", {
              name: customer.firstName.toLocaleUpperCase(htmlLang),
            })
          : t("WELCOME BACK.")}
      </h2>
      {!club.active && (
        <p className="club-page-note">
          {t("Your membership is currently inactive. Contact us for help.")}
        </p>
      )}
      <dl className="club-page-points" aria-busy={loading}>
        <div>
          <dt>{t("Your points")}</dt>
          <dd>
            <strong>{number.format(balance)}</strong>{" "}
            {t(balance === 1 ? "point" : "points")}
          </dd>
        </div>
      </dl>
      {targetPoints > 0 && (
        <div className="club-page-reward">
          <div className="club-page-reward-label">
            <span>{t("Points to your next reward")}</span>
            <span>
              {number.format(earned)} / {number.format(targetPoints)}
            </span>
          </div>
          <div
            className="club-page-progress"
            role="progressbar"
            aria-label={t("Points to your next reward")}
            aria-valuemin={0}
            aria-valuemax={targetPoints}
            aria-valuenow={earned}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="club-page-note">
            {t(
              remaining === 1
                ? "1 point to your next reward. It arrives as a code in your inbox."
                : "{remaining} points to your next reward. It arrives as a code in your inbox.",
              { remaining: number.format(remaining) },
            )}
          </p>
        </div>
      )}
      <dl className="club-page-stats">
        <div>
          <dt>{t("Earned in total")}</dt>
          <dd>
            {number.format(lifetime)} {t(lifetime === 1 ? "point" : "points")}
          </dd>
        </div>
        <div>
          <dt>{t("Your earning rate")}</dt>
          <dd>
            {t(
              club.earning.pointsPerUnit === 1
                ? "You earn 1 point per {currency}."
                : "You earn {points} points per {currency}.",
              {
                points: number.format(club.earning.pointsPerUnit),
                currency: club.earning.currency,
              },
            )}
          </dd>
        </div>
      </dl>
      <div className="club-page-member-footer">
        <ShopLink />
        <Link className="club-page-login" href={href("/account")}>
          {t("Your account")}
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    </>
  );
}

function ClubGuide() {
  const { t } = usePreferences();
  const { catalog } = useStore();
  const { joinMethod } = catalog.accounts.customerClub;
  const joinDescription =
    joinMethod === "manual"
      ? clubJoinHint.manual
      : joinMethod === "auto"
        ? clubJoinHint.auto
        : "Choose the club option when you create your account.";

  return (
    <section
      className="club-page-guide"
      id="club-guide"
      aria-labelledby="club-guide-heading"
    >
      <div className="club-page-guide-heading">
        <p className="eyebrow">{t("A LITTLE MORE FROM YOUR EVERYDAY")}</p>
        <h2 id="club-guide-heading">{t("GOOD HABITS. GOOD REWARDS.")}</h2>
      </div>
      <ol className="club-page-steps">
        {[
          {
            title: "Make yourself at home.",
            description: joinDescription,
            icon: "user" as const,
          },
          {
            title: "Find your everyday.",
            description:
              "Shop while logged in to earn points on your purchases.",
            icon: "bag" as const,
          },
          {
            title: "Enjoy a little extra.",
            description:
              "Reach the goal and a reward code lands in your inbox.",
            icon: "spark" as const,
          },
        ].map((step, index) => (
          <li key={step.title}>
            <div className="club-page-step-top">
              <span>0{index + 1}</span>
              <Icon name={step.icon} size={24} />
            </div>
            <h3>{t(step.title)}</h3>
            <p>{t(step.description)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClubComingSoon() {
  const { t } = usePreferences();
  return (
    <>
      <p className="eyebrow">{t("THE EVERYDAY CLUB")}</p>
      <h2>{t("ACCOUNTS ARE ON THEIR WAY.")}</h2>
      <p className="club-page-description">
        {t(
          "Customer accounts and the Everyday Club open soon. Until then, you can shop and check out as a guest.",
        )}
      </p>
      <div className="club-page-actions">
        <ShopLink />
      </div>
    </>
  );
}

function ShopLink() {
  const { t, href } = usePreferences();
  return (
    <Link className="button button-dark" href={href("/#shop")}>
      {t("EXPLORE ALL ESSENTIALS ")}
      <Icon name="arrow" size={18} />
    </Link>
  );
}

function ClubLoading() {
  const { t } = usePreferences();
  return (
    <div className="club-page-loading" role="status" aria-busy="true">
      <span className="sr-only">{t("Loading your club")}</span>
      <div />
      <div />
      <div />
    </div>
  );
}
