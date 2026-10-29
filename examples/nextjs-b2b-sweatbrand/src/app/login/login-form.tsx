"use client"

import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { TextField, required, validEmail } from "@/components/form-field"
import { errorMessage } from "@/lib/errors"
import { useSession } from "@/lib/use-session"

export function LoginForm() {
  const { login, isLoggedIn, customer } = useSession()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        await login({ email: value.email.trim(), password: value.password })
        router.push("/")
      } catch (e) {
        setError(errorMessage(e))
      }
    },
  })

  if (isLoggedIn) {
    return (
      <div className="form-card">
        <p>
          You&apos;re signed in{customer?.email ? ` as ${customer.email}` : ""}. <Link href="/">Go to the catalogue →</Link>
        </p>
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
      <form.Field name="email" validators={{ onBlur: validEmail, onSubmit: validEmail }}>
        {(field) => <TextField field={field} label="Email" type="email" autoComplete="username" autoFocus />}
      </form.Field>
      <form.Field name="password" validators={{ onSubmit: required("Enter your password") }}>
        {(field) => <TextField field={field} label="Password" type="password" autoComplete="current-password" />}
      </form.Field>

      {error && (
        <p role="alert" className="form-card__error">
          {error}
        </p>
      )}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <button type="submit" className="button button--block" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        )}
      </form.Subscribe>

      <p className="form-card__aside">
        <Link href="/reset-password">Forgot your password?</Link>
        <span>
          New buyer? <Link href="/register">Open a trade account</Link>
        </span>
      </p>
    </form>
  )
}
