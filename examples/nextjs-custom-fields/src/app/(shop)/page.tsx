import Link from "next/link"
import Image from "next/image"
import { ArrowRightIcon } from "@/components/icons"
import { SignMock } from "@/components/SignMock"
import { getProducts } from "@/lib/shopkit"
import { SAMPLE, SCENES } from "@/lib/showcase"
import { fromPrice, materialFor, money, sellableVariants, variantSize } from "@/lib/signs"

export default async function HomePage() {
  const products = await getProducts()
  const byKey = new Map(products.map((p) => [materialFor(p).key, p]))
  const heroScene = SCENES[0]

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Custom signs, made for your space</p>
          <h1>
            Your sign.
            <br />
            <span className="hero-accent">Your rules.</span>
          </h1>
          <p className="lede">
            Choose a sign, upload your artwork, and arrange it on a true-to-scale canvas. We print the design
            you create.
          </p>
          <div className="hero-actions">
            <Link href="#signs" className="btn btn-primary btn-lg">
              Choose your sign <ArrowRightIcon />
            </Link>
            <Link href="#inspiration" className="btn btn-ghost btn-lg">
              See signs in a space
            </Link>
          </div>
          <ul className="hero-facts">
            <li>
              <strong>6</strong> materials
            </li>
            <li>
              <strong>18</strong> sizes
            </li>
            <li>
              <strong>3–5 days</strong> to print &amp; ship
            </li>
          </ul>
        </div>
        <figure className="hero-scene">
          <div className="hero-scene-image">
            <Image
              src={heroScene.image}
              alt={heroScene.alt}
              fill
              sizes="(max-width: 860px) calc(100vw - 32px), (max-width: 1240px) 48vw, 580px"
              loading="eager"
              fetchPriority="high"
            />
          </div>
          <figcaption>
            <span>
              <strong>Clear acrylic · Office reception</strong>
              <br />
              Illustrative mockup with example artwork.
            </span>
            <a href="#inspiration" className="scene-text-link">
              Explore spaces <ArrowRightIcon width={16} height={16} />
            </a>
          </figcaption>
        </figure>
      </section>

      <section id="signs" className="section">
        <div className="section-head">
          <p className="eyebrow">Step 1</p>
          <h2>Choose your sign</h2>
          <p className="muted">Every sign comes in three sizes. You can switch size in the designer at any time.</p>
        </div>
        <ul className="product-grid">
          {products.map((p) => {
            const m = materialFor(p)
            const variants = sellableVariants(p)
            const first = variantSize(variants[0])
            return (
              <li key={p.id}>
                <Link href={`/products/${p.slug}`} className="product-card" style={{ "--material-accent": m.accent } as React.CSSProperties}>
                  <div className="product-card-art">
                    <SignMock material={m} ratio={first.widthMm / first.heightMm} {...SAMPLE[m.key]} />
                  </div>
                  <div className="product-card-body">
                    <div>
                      <h3>{p.name}</h3>
                      <p className="muted">{m.tagline}</p>
                    </div>
                    <p className="price">
                      <span className="muted">from</span> {money(fromPrice(p))}
                    </p>
                  </div>
                  <span className="product-card-cta">
                    Design it <ArrowRightIcon width={16} height={16} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <section id="inspiration" className="section inspiration" aria-labelledby="inspiration-title">
        <div className="section-head">
          <p className="eyebrow">In context</p>
          <h2 id="inspiration-title">See it in your space</h2>
          <p className="muted">A welcome at reception. A name at the door. Find a material that feels at home.</p>
        </div>
        <ul className="scene-grid">
          {SCENES.map((scene) => {
            const product = byKey.get(scene.material)
            return (
              <li key={scene.material}>
                <figure className="scene-example">
                  <div className="scene-example-image">
                    <Image
                      src={scene.image}
                      alt={scene.alt}
                      fill
                      sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 860px) 45vw, (max-width: 1240px) 30vw, 384px"
                    />
                  </div>
                  <figcaption>
                    <p className="scene-material">{scene.material === "wood" ? "Birch plywood" : scene.material === "acrylic" ? "Clear acrylic" : "Aluminium composite"}</p>
                    <h3>{scene.title}</h3>
                    <p className="scene-description">{scene.description}</p>
                    {product && (
                      <Link href={`/products/${product.slug}`} className="scene-text-link">
                        Explore {scene.material === "wood" ? "wooden" : scene.material} signs <ArrowRightIcon width={16} height={16} />
                      </Link>
                    )}
                  </figcaption>
                </figure>
              </li>
            )
          })}
        </ul>
        <p className="scene-note">Illustrative mockups with example artwork. Create your own design with any sign.</p>
      </section>

      <section id="how" className="section how">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2>From idea to wall in three steps</h2>
        </div>
        <ol className="steps">
          <li>
            <span className="step-num">01</span>
            <h3>Pick a sign</h3>
            <p>Aluminium for the street, acrylic for the lobby, birch for the café. Choose the size that fits.</p>
          </li>
          <li>
            <span className="step-num">02</span>
            <h3>Make it yours</h3>
            <p>Upload images, add text, then drag, resize and rotate everything freely on a true-to-scale canvas.</p>
          </li>
          <li>
            <span className="step-num">03</span>
            <h3>We print &amp; ship</h3>
            <p>Your exact layout goes to print as a high-resolution file and ships within 3–5 working days.</p>
          </li>
        </ol>
      </section>
    </main>
  )
}
