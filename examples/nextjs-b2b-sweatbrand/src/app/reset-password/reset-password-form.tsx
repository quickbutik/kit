"use client"

import { useCustomer } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useState } from "react"
import { CodeForm } from "@/components/code-form"
import { TextField, validEmail } from "@/components/form-field"
import { errorMessage } from "@/lib/errors"

export function ResetPasswordForm() {
  const { requestPasswordReset } = useCustomer()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      setError(null)
      const email = value.email.trim()
      try {
        await requestPasswordReset({ email })
        setSentTo(email)
      } catch (e) {
        setError(errorMessage(e))
      }
    },
  })

  if (sentTo) return <CodeForm email={sentTo} submitLabel="Set password and sign in" />

  return (
    <form
      className="form-card"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="email" validators={{ onBlur: validEmail, onSubmit: validEmail }}>
        {(field) => <TextField field={field} label="Email" type="email" autoComplete="email" autoFocus />}
      </form.Field>

      {error && (
        <p role="alert" className="form-card__error">
          {error}
        </p>
      )}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <button type="submit" className="button button--block" disabled={submitting}>
            {submitting ? "Sending…" : "Email me a code"}
          </button>
        )}
      </form.Subscribe>

      <p className="form-card__aside">
        <Link href="/login">← Back to sign in</Link>
      </p>
    </form>
  )
}
