# Decision Studio

A working demo of a configurable loan decisioning engine, built to show how
lending decisions can move from a manual queue to a sub-second, fully traceable
pipeline built on configurable primitives.

**Live demo:** https://decision-studio-subhasishgoswami02s-projects.vercel.app

## What it demonstrates

- **Instant decisions with a full audit trace.** Every application returns a
  decision in milliseconds, with each pipeline stage (eligibility, scorecard,
  thresholds, pricing, routing) logged step by step.
- **Configuration over code.** Eligibility rules, score thresholds, and pricing
  tiers are all editable from the Rules Console at runtime. No deploy needed.
- **Safe rollback.** One click restores the default configuration.

The pipeline mirrors how real student lending decisioning works: knockout
eligibility rules first, then a weighted scorecard, then threshold-based
approve/review/decline, then risk-based pricing, then partner routing.

## Architecture

- Next.js (pages router), React front end, API route as the backend
- `lib/engine.js` is a pure, deterministic decisioning engine with zero I/O,
  so it is unit-testable and the trace is reproducible
- Configuration lives client-side (localStorage) in this demo and is sent with
  each request; in production this would be a versioned config service with
  approvals and audit history

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy

Push to GitHub, then import the repo at vercel.com. No environment variables
needed. Vercel auto-detects Next.js.

## Author

Subhasish Goswami, Senior Manager, Product.
Built as a portfolio artifact; all rules, tiers, and numbers are illustrative,
not any lender's actual credit policy.
