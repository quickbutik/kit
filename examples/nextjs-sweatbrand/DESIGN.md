# Sweatbrand: design brief

## What we sell

Training wear and everyday essentials. The existing Quickbutik catalog supplies all product information and prices.

## Who buys

People choosing clothing for training and daily life.

## How it should feel

The account pages were “a little too empty,” but should not become cluttered. Keep the storefront’s restrained editorial style and give utility pages more structure.

## Principles

- Keep forms and their primary action easy to find.
- Use rules and changes in surface color to give content structure.
- Carry the Everyday Club identity through account pages.
- Keep real account details and reward data readable.
- Keep layouts comfortable on phones and in every supported language.

## Decisions

- Account pages: a contained form beside a quiet brand panel; one column on smaller screens.
- Mega menus: two columns of navigation and a compact product preview, separated by a fine rule; no campaign banners or slogan strip.
- Size guide: an editorial `/size-guide` page with a photographic introduction, clothing/socks/cap charts, a body measuring illustration, three fit silhouettes, and accessible FAQ disclosures. Reuse the existing demo measurements in product guides and the full page. Reference Nike’s body-measurement and unit-switching pattern and Patagonia’s fit explanations; retain SWEATBRAND’s own copy and sizing. Localize the whole guide in all four storefront languages.
- Washing guide: `/washing-guide` shares the size guide’s typography, palette and section layout, with original laundry illustrations, selectable garment groups, care-label explanations, source links and FAQ disclosures. General advice follows Nike’s activewear guidance and GINETEX’s symbol explanations; each garment’s own care label takes priority. Footer and product care links lead here. Translate all copy in the four storefront languages.
- History: `/history` expands the existing “Our story” into a photographic editorial page about the concept brand’s mindset, clothing rotation and Everyday Club. Use established campaign imagery and brand copy; do not invent founders, dates, business milestones or manufacturing claims. Keep the concept-store disclosure and link from the homepage and footer. Translate in all four languages.
- Palette: existing warm cream, charcoal ink, and soft blue. Account surfaces use lightly tinted paper.
- Type: existing Anton display and Geist body; tabular figures for points.
- Motion: subtle button press feedback, with reduced motion respected.
- Loading: category pages show a skeleton of the final layout (real shared copy, flat placeholders for the category's own) while they stream in. One slow viewport-wide sheen passes over it; reduced motion keeps it static. The Everyday Club has explicitly requested atmospheric motion, with a static reduced-motion treatment.
- Everyday Club: an immersive `/club` landing page in smoked metal and champagne foil. A flowing WebGL light field, a floating membership pass with pointer tilt, oversized type and a photographic closing section make joining feel special. The join/sign-in area becomes a live points dashboard. Club navigation and homepage teasers lead here.
- Club navigation: native React view transitions crossfade the visible viewport, including the header, for 460 ms when crossing between the club and the light shop. Synchronous browser history restoration uses matching CSS color and content fades. Other routes stay immediate; reduced motion disables the fade. The shop's state and Next.js navigation remain intact.

## Never

- Add invented benefits, account data, reviews, or urgency.
- Add decorative animations outside the Everyday Club or competing primary actions.
- Change authentication behavior during a design pass.
