import type { Metadata } from "next"
import { ResetPasswordForm } from "./reset-password-form"

export const metadata: Metadata = { title: "Reset password", robots: { index: false } }

export default function ResetPasswordPage() {
  return (
    <section className="form-page">
      <header className="form-page__head">
        <p className="eyebrow">Trade accounts</p>
        <h1 className="form-page__title">Reset password</h1>
        <p className="form-page__lede">We&apos;ll email you a one-time code to set a new password.</p>
      </header>
      <ResetPasswordForm />
    </section>
  )
}
