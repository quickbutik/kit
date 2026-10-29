import type { Metadata } from "next"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in", robots: { index: false } }

export default function LoginPage() {
  return (
    <section className="form-page">
      <header className="form-page__head">
        <p className="eyebrow">Trade accounts</p>
        <h1 className="form-page__title">Sign in</h1>
        <p className="form-page__lede">Sign in to see your wholesale prices and place orders.</p>
      </header>
      <LoginForm />
    </section>
  )
}
