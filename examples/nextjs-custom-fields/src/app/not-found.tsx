import Link from "next/link"

export default function NotFound() {
  return (
    <main className="success-page">
      <div className="success-card">
        <h1>Nothing here</h1>
        <p>That page doesn&apos;t exist, or the sign is no longer available.</p>
        <Link href="/" className="btn btn-primary">
          Browse signs
        </Link>
      </div>
    </main>
  )
}
