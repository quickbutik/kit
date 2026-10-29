"use client"

import type { ConsentBannerState } from "@quickbutik/kit/react"
import { useConsent } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import { useId } from "react"

/**
 * Our own cookie banner, rendered by the kit in place of its default dialog
 * (ShopkitProvider `consent.banner`). The kit still owns the decision: it stores
 * it, gates the shop's analytics on it and forwards it to the hosted checkout.
 */
export function CookieBanner({ state }: { state: ConsentBannerState }) {
  const titleId = useId()
  if (!state.visible) return null

  return (
    <section className="cookie" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      {state.open ? (
        <CookieSettings state={state} titleId={titleId} />
      ) : (
        <>
          <p className="cookie__eyebrow" id={titleId}>
            Cookies
          </p>
          <p className="cookie__text">
            We use necessary cookies to run the catalogue and your order. With your OK we also use analytics and
            marketing cookies to improve the shop.
          </p>
          <div className="cookie__actions">
            <button type="button" className="cookie__btn cookie__btn--primary" onClick={state.acceptAll}>
              Accept all
            </button>
            <button type="button" className="cookie__btn" onClick={state.rejectAll}>
              Only necessary
            </button>
            <button type="button" className="cookie__link" onClick={state.openSettings}>
              Settings
            </button>
          </div>
        </>
      )}
    </section>
  )
}

const CATEGORIES = [
  { name: "analytics", label: "Analytics", description: "Anonymous statistics on how the catalogue is used." },
  { name: "marketing", label: "Marketing", description: "Measuring and personalising our ads." },
] as const

function CookieSettings({ state, titleId }: { state: ConsentBannerState; titleId: string }) {
  const { save } = useConsent()

  const form = useForm({
    defaultValues: { analytics: state.draft.analytics, marketing: state.draft.marketing },
    onSubmit: ({ value }) => save(value),
  })

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="cookie__head">
        <p className="cookie__eyebrow" id={titleId}>
          Cookie settings
        </p>
        <button type="button" className="cookie__close" aria-label={state.labels.close} onClick={state.closeSettings}>
          ×
        </button>
      </div>

      <ul className="cookie__list">
        <li className="cookie__row">
          <span className="cookie__row-text">
            <span className="cookie__row-label">Necessary</span>
            <span className="cookie__row-desc">Sign-in, your order sheet and checkout. Always on.</span>
          </span>
          <span className="cookie__switch" data-locked>
            <input type="checkbox" checked disabled aria-label="Necessary cookies, always on" />
            <span aria-hidden />
          </span>
        </li>
        {CATEGORIES.map((category) => (
          <form.Field key={category.name} name={category.name}>
            {(field) => (
              <li className="cookie__row">
                <label className="cookie__row-text" htmlFor={`cookie-${category.name}`}>
                  <span className="cookie__row-label">{category.label}</span>
                  <span className="cookie__row-desc">{category.description}</span>
                </label>
                <span className="cookie__switch">
                  <input
                    id={`cookie-${category.name}`}
                    type="checkbox"
                    role="switch"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  <span aria-hidden />
                </span>
              </li>
            )}
          </form.Field>
        ))}
      </ul>

      <div className="cookie__actions">
        <button type="submit" className="cookie__btn cookie__btn--primary">
          Save choices
        </button>
        <button type="button" className="cookie__btn" onClick={state.acceptAll}>
          Accept all
        </button>
      </div>
    </form>
  )
}
