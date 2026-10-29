import Link from "next/link"
import { CartBadge } from "@/components/CartBadge"
import { getShop } from "@/lib/shopkit"

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const shop = await getShop()
  const name = shop?.name ?? "Custom Signs"
  return (
    <div className="shell">
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label={`${name} home`}>
          <span className="wordmark-mark" aria-hidden="true">
            <span />
          </span>
          {name}
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/#signs">Signs</Link>
          <Link href="/#inspiration">Inspiration</Link>
          <Link href="/#how">How it works</Link>
          <CartBadge />
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <div>
          <strong>{name}</strong>
          <p>Custom signs, printed with care and shipped in 3–5 working days.</p>
        </div>
        <p className="muted">Secure checkout by Quickbutik</p>
      </footer>
    </div>
  )
}
