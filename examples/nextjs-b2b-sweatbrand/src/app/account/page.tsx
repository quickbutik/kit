import type { Metadata } from "next"
import { AccountDetails } from "./account-details"

export const metadata: Metadata = { title: "Account", robots: { index: false } }

export default function AccountPage() {
  return (
    <section className="form-page">
      <header className="form-page__head">
        <p className="eyebrow">Trade account</p>
        <h1 className="form-page__title">Account</h1>
      </header>
      <AccountDetails />
    </section>
  )
}
