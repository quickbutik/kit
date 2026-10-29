import type { Metadata } from "next"
import { RegisterForm } from "./register-form"

export const metadata: Metadata = { title: "Open a trade account", robots: { index: false } }

export default function RegisterPage() {
  return (
    <section className="form-page form-page--wide">
      <header className="form-page__head">
        <p className="eyebrow">Trade accounts</p>
        <h1 className="form-page__title">Open a trade account</h1>
        <p className="form-page__lede">
          For clothing retailers. Once your account is open you&apos;ll see wholesale prices ex. moms and can order
          straight from the catalogue.
        </p>
      </header>
      <RegisterForm />
    </section>
  )
}
