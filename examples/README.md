# Examples

Three storefronts, three kinds of shop. Each one is a full Next.js app backed by a real Quickbutik shop, with the hosted Quickbutik checkout for payment. Click a screenshot to open the live demo.

<table>
  <tr>
    <td colspan="2">
      <a href="https://sweatbrand-demo.vercel.app">
        <img src="../.github/assets/examples/sweatbrand.jpg" alt="Sweatbrand: a workout-wear storefront with a split hero of two athletes" width="100%" />
      </a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Sweatbrand</h3>
      <p>A street-inspired workout-wear concept store: mega menus, live search, product pages with a variant picker, a cart drawer, and customer accounts with a loyalty club. Available in four languages.</p>
      <p>
        <a href="https://sweatbrand-demo.vercel.app"><b>Live demo ↗</b></a>
        &nbsp;·&nbsp;
        <a href="./nextjs-sweatbrand"><b>Source code</b></a>
      </p>
    </td>
    <td width="50%" valign="top">
      <b>Quickbutik features</b>
      <ul>
        <li>Products, variants (color × size), categories and search</li>
        <li>Server-side cart and hosted checkout in the shopper's language</li>
        <li>Customer login, registration and password reset</li>
        <li>Customer club with points and rewards</li>
        <li>Cookie consent passed on to GA4, GTM and Meta pixel</li>
        <li>SEO and JSON-LD for products, breadcrumbs and the organization</li>
        <li>Thank-you page with order confirmation polling</li>
      </ul>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td colspan="2">
      <a href="https://sweatbrand-b2b.vercel.app">
        <img src="../.github/assets/examples/sweatbrand-b2b.jpg" alt="Sweatbrand B2B: a wholesale catalogue with a color × size order grid" width="100%" />
      </a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Sweatbrand B2B</h3>
      <p>A wholesale storefront for the same brand. Trade customers sign in to see their prices ex. VAT and fill a color × size order grid per style. Discount levels (up to 25% off) come from the customer's group.</p>
      <p>
        <a href="https://sweatbrand-b2b.vercel.app"><b>Live demo ↗</b></a>
        &nbsp;·&nbsp;
        <a href="./nextjs-b2b-sweatbrand"><b>Source code</b></a>
      </p>
    </td>
    <td width="50%" valign="top">
      <b>Quickbutik features</b>
      <ul>
        <li>Customer groups with per-customer pricing</li>
        <li>Prices shown only to signed-in customers</li>
        <li>Trade account registration, login and password reset</li>
        <li>Bulk ordering across variants into one cart</li>
        <li>Customer club</li>
        <li>Cookie consent, hosted checkout and order confirmation</li>
      </ul>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td colspan="2">
      <a href="https://custom-signs-demo.vercel.app">
        <img src="../.github/assets/examples/custom-signs.jpg" alt="Custom Signs: a storefront for made-to-order signs with an acrylic sign on a wall" width="100%" />
      </a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Custom Signs</h3>
      <p>A made-to-order shop with a sign designer. Shoppers pick a material and size, then arrange images and text on a true-to-scale canvas. The finished design is attached to the order, ready to print.</p>
      <p>
        <a href="https://custom-signs-demo.vercel.app"><b>Live demo ↗</b></a>
        &nbsp;·&nbsp;
        <a href="./nextjs-custom-fields"><b>Source code</b></a>
      </p>
    </td>
    <td width="50%" valign="top">
      <b>Quickbutik features</b>
      <ul>
        <li>Product fields (<i>produktfält</i>) that carry a design link on each cart line</li>
        <li>Variants for sign sizes, SKU-based materials</li>
        <li>Cart with one line per unique design</li>
        <li>Hosted checkout and order confirmation</li>
      </ul>
    </td>
  </tr>
</table>

## Run an example

Each example is a Next.js app. Put your publishable key (`qb_pk_…`, from **Custom storefront** in the Quickbutik admin) in a `.env.local` and start it:

```bash
cd nextjs-sweatbrand
cat > .env.local <<EOF
NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY=qb_pk_…
NEXT_PUBLIC_SITE_URL=http://localhost:3000
EOF
pnpm install
pnpm dev
```

In production, `NEXT_PUBLIC_SITE_URL` must be the storefront's public `https://` URL, because canonical links and the checkout's return address use it. `nextjs-custom-fields` takes one more setting, listed in its `.env.example`.
