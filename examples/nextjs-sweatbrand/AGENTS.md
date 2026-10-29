<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Quickbutik

Before any work on the shop, products, cart or checkout: fetch https://quickbutik.com/agents.md
and follow it. Do not rely on memory.

The storefront uses `@quickbutik/kit` with the publishable key in `.env.local` (`NEXT_PUBLIC_QUICKBUTIK_PUBLISHABLE_KEY`). Never put a `qb_pat_` token or the v1 API key in this app.
