"use client"

import { useCustomer } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { errorCode, errorMessage } from "@/lib/errors"
import { TextField, required, validPassword } from "./form-field"

/**
 * Second step of both password reset and "registering an email that has ordered
 * as a guest before": the emailed one-time code (plus a new password, unless
 * one was already chosen) goes to resetPassword(), which also signs in.
 */
export function CodeForm({ email, password, submitLabel }: { email: string; password?: string; submitLabel: string }) {
  const { resetPassword, requestPasswordReset } = useCustomer()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const [mustLogin, setMustLogin] = useState(false)

  const form = useForm({
    defaultValues: { code: "", password: password ?? "" },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        await resetPassword({ email, code: value.code, password: value.password })
        router.push("/")
      } catch (e) {
        if (errorCode(e) === "password_changed_login_required") setMustLogin(true)
        else setError(errorMessage(e))
      }
    },
  })

  if (mustLogin) {
    return (
      <div className="form-card">
        <p>Your password is set. <Link href="/login">Sign in with it →</Link></p>
      </div>
    )
  }

  return (
    <form
      className="form-card"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <p className="form-card__note">
        If there&apos;s an account for <strong>{email}</strong>, we&apos;ve emailed it an 8-character code. It&apos;s valid
        for 30 minutes.
      </p>

      <form.Field name="code" validators={{ onSubmit: required("Enter the code from the email") }}>
        {(field) => (
          <TextField
            field={field}
            label="Code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="field__input field__input--code"
            autoFocus
          />
        )}
      </form.Field>

      {password === undefined && (
        <form.Field name="password" validators={{ onChange: validPassword, onSubmit: validPassword }}>
          {(field) => (
            <TextField field={field} label="New password" type="password" autoComplete="new-password" hint="6–40 characters" />
          )}
        </form.Field>
      )}

      {error && (
        <p role="alert" className="form-card__error">
          {error}
        </p>
      )}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <button type="submit" className="button button--block" disabled={submitting}>
            {submitting ? "Checking…" : submitLabel}
          </button>
        )}
      </form.Subscribe>

      <p className="form-card__aside">
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            setError(null)
            try {
              await requestPasswordReset({ email })
              setResent(true)
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
        >
          {resent ? "New code sent" : "Send a new code"}
        </button>
      </p>
    </form>
  )
}
