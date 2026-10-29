"use client"

import { useCustomer } from "@quickbutik/kit/react"
import { useForm } from "@tanstack/react-form"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { CodeForm } from "@/components/code-form"
import { TextField, required, validEmail, validPassword } from "@/components/form-field"
import { errorCode, errorMessage } from "@/lib/errors"

/** Swedish organisationsnummer: 10 digits, optionally NNNNNN-NNNN. Other formats are accepted as typed. */
const validOrgNumber = ({ value }: { value: string }) => {
  const v = value.trim()
  if (!v) return "Enter your company registration number"
  if (v.length < 6) return "That looks too short"
  return undefined
}

export function RegisterForm() {
  const { register } = useCustomer()
  const router = useRouter()
  const [error, setError] = useState<{ text: string; code: string | null } | null>(null)
  const [verify, setVerify] = useState<{ email: string; password: string } | null>(null)

  const form = useForm({
    defaultValues: {
      companyName: "",
      companyNumber: "",
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      clubOptIn: false,
      acceptTerms: false,
    },
    onSubmit: async ({ value }) => {
      setError(null)
      const email = value.email.trim()
      try {
        const result = await register({
          email,
          password: value.password,
          firstName: value.firstName.trim(),
          lastName: value.lastName.trim(),
          companyName: value.companyName.trim(),
          companyNumber: value.companyNumber.trim(),
          clubOptIn: value.clubOptIn,
        })
        if (result.status === "logged_in") router.push("/")
        else if (result.status === "verification_required") setVerify({ email, password: value.password })
        else router.push("/login")
      } catch (e) {
        setError({ text: errorMessage(e), code: errorCode(e) })
      }
    },
  })

  if (verify) {
    return (
      <div className="form-stack">
        <p className="form-card__note form-card__note--banner">
          It looks like you&apos;ve ordered from us before. Confirm the email address to attach your account to your
          earlier orders.
        </p>
        <CodeForm email={verify.email} password={verify.password} submitLabel="Confirm and open account" />
      </div>
    )
  }

  return (
    <form
      className="form-card form-card--wide"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset className="form-section">
        <legend className="form-section__title">
          <span className="form-section__no">01</span> Company
        </legend>
        <div className="form-row">
          <form.Field
            name="companyName"
            validators={{ onBlur: required("Enter your company name"), onSubmit: required("Enter your company name") }}
          >
            {(field) => <TextField field={field} label="Company name" autoComplete="organization" />}
          </form.Field>
          <form.Field name="companyNumber" validators={{ onBlur: validOrgNumber, onSubmit: validOrgNumber }}>
            {(field) => <TextField field={field} label="Org. number" placeholder="556677-8899" hint="Organisationsnummer" />}
          </form.Field>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">
          <span className="form-section__no">02</span> Buyer
        </legend>
        <div className="form-row">
          <form.Field
            name="firstName"
            validators={{ onBlur: required("Enter your first name"), onSubmit: required("Enter your first name") }}
          >
            {(field) => <TextField field={field} label="First name" autoComplete="given-name" />}
          </form.Field>
          <form.Field
            name="lastName"
            validators={{ onBlur: required("Enter your last name"), onSubmit: required("Enter your last name") }}
          >
            {(field) => <TextField field={field} label="Last name" autoComplete="family-name" />}
          </form.Field>
        </div>
        <form.Field name="email" validators={{ onBlur: validEmail, onSubmit: validEmail }}>
          {(field) => <TextField field={field} label="Work email" type="email" autoComplete="email" />}
        </form.Field>
      </fieldset>

      <fieldset className="form-section">
        <legend className="form-section__title">
          <span className="form-section__no">03</span> Password
        </legend>
        <div className="form-row">
          <form.Field name="password" validators={{ onBlur: validPassword, onSubmit: validPassword }}>
            {(field) => (
              <TextField field={field} label="Password" type="password" autoComplete="new-password" hint="6–40 characters" />
            )}
          </form.Field>
          <form.Field
            name="confirmPassword"
            validators={{
              onChangeListenTo: ["password"],
              onBlur: ({ value, fieldApi }) =>
                value !== fieldApi.form.getFieldValue("password") ? "The passwords don't match" : undefined,
              onSubmit: ({ value, fieldApi }) =>
                value !== fieldApi.form.getFieldValue("password") ? "The passwords don't match" : undefined,
            }}
          >
            {(field) => <TextField field={field} label="Repeat password" type="password" autoComplete="new-password" />}
          </form.Field>
        </div>
      </fieldset>

      <div className="form-section form-section--checks">
        <form.Field
          name="acceptTerms"
          validators={{ onSubmit: ({ value }) => (value ? undefined : "You need to accept the terms of trade") }}
        >
          {(field) => (
            <div className={`check${field.state.meta.errors.length ? " check--error" : ""}`}>
              <input
                id={field.name}
                type="checkbox"
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
                onBlur={field.handleBlur}
              />
              <label htmlFor={field.name}>
                I buy for resale and accept the{" "}
                <a href="https://sweatshop-b2b.quickbutik.com/sidor/kopvillkor" target="_blank" rel="noreferrer">
                  terms of trade
                </a>
                .
              </label>
              {field.state.meta.errors[0] && <p className="field__error">{String(field.state.meta.errors[0])}</p>}
            </div>
          )}
        </form.Field>
        <form.Field name="clubOptIn">
          {(field) => (
            <div className="check">
              <input
                id={field.name}
                type="checkbox"
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
              />
              <label htmlFor={field.name}>Join the loyalty club and earn points on every order.</label>
            </div>
          )}
        </form.Field>
      </div>

      {error && (
        <p role="alert" className="form-card__error">
          {error.text}{" "}
          {error.code === "email_taken" && (
            <>
              <Link href="/login">Sign in</Link> or <Link href="/reset-password">reset your password</Link>.
            </>
          )}
        </p>
      )}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <button type="submit" className="button button--block" disabled={submitting}>
            {submitting ? "Opening account…" : "Open trade account"}
          </button>
        )}
      </form.Subscribe>

      <p className="form-card__aside">
        <span>
          Already have an account? <Link href="/login">Sign in</Link>
        </span>
      </p>
    </form>
  )
}
