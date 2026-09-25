# Decision Studio

[![CI](https://github.com/subhasishgoswami02/decision-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/subhasishgoswami02/decision-studio/actions/workflows/ci.yml)

Decision Studio is a small, working student-loan decisioning engine. You submit an applicant and get a decision back with every step written out: which knockout rules passed or failed, how the score was built, which price band applied and which lending partner the loan would go to. The rules are editable in the browser, and a set of hand-worked test applicants shows which decisions a rule change would move before you use it. The engine is rules-based and deterministic. There is no machine learning in it. It is a personal prototype, and every rule, weight and rate is illustrative.

**Live demo:** https://decision-studio-one.vercel.app

## What you can do

- **Apply.** Pick one of five sample applicants (strong, thin credit file, borderline, low score, ineligible) or fill in the form yourself. The form validates in the browser with the same schema the API uses, so an error you see on screen is the same rule the server would enforce. If you change the form after a decision, the old result is marked as out of date until you ask again.
- **Read the decision trace.** Every result lists each step the engine took, in order: intake, each eligibility rule (pass, fail or skipped), each scorecard factor with its points, the threshold comparison, pricing and routing. The result also shows the score against the approve and review lines, the points each factor contributed, and the engine time next to the round-trip time.
- **See what would change the outcome.** For anything short of an approval, the engine suggests the smallest change it can confirm. If a lower loan amount would get approved, it finds the largest round thousand that does, and you can try it with one click. If the application failed a knockout rule, it says what each failed rule needs (naming the accepted countries for a destination failure). If even the minimum amount would not be approved, it says so and names the factor with the biggest gap. Nothing is estimated: every suggestion comes from real engine runs.
- **Edit the policy in the rules console.** Switch eligibility rules on and off, change the loan floor and ceiling, accepted destinations, enrollment window and minimum school tier, move the approve and review thresholds, and edit each pricing band's minimum score and APR. Number fields save when you press Enter or leave the field, never on a half-typed value. A rejected value keeps the old one and says so ("Not saved; the rule still uses 65"). An impact line at the top of the console reruns all the test applicants on every change and tells you how many would now be decided differently and how approvals move. One button resets to the defaults.
- **Check the policy tests page.** It lists all 21 test applicants with the decision the default policy should give, the reason worked out by hand, and the decision under the active policy. Rows that change under your edits are highlighted and marked as a better or worse outcome for the applicant.

## How a decision is made

The engine (`lib/engine.js`) is one pure function, `decide(applicant, config)`. It runs five stages in a fixed order. The numbers below are the defaults in `lib/defaults.js`.

1. **Eligibility knockouts.** Every enabled rule runs, and all failures are collected, so a decline names every rule that failed instead of stopping at the first. Defaults: loan amount from $5,000 to $100,000 inclusive; destination US or CA; admission confirmed; expected graduation in the future and no more than 48 months out; school tier 3 or better (tier 4 is unranked). A graduate-only rule exists but is off by default. Any failure declines the application and scoring never runs.
2. **Scorecard.** Six factors each score from 0 to 1 and are multiplied by a weight. The weights add up to 100. The total is rounded to one decimal once, and that rounded score is the one the thresholds, pricing and the response all use, so a score shown as 65.0 is always approved:

   | Factor | Weight | How it scores |
   |---|---|---|
   | School tier | 25 | Tier 1 is 1.0, tier 2 is 0.7, tier 3 is 0.4, otherwise 0.2 |
   | Field of study | 15 | Field score (STEM and medicine 1.0, business 0.85, law 0.7, other 0.55) times a degree multiplier, capped at 1 |
   | Credit history | 20 | Established 1.0, thin 0.6, none 0.3 |
   | Income coverage | 20 | Household income divided by loan amount, divided by 1.5, clamped to 0 to 1 |
   | Work experience | 10 | 6+ years 1.0, 3+ years 0.85, 1+ year 0.6, otherwise 0.4 |
   | Country risk | 10 | Citizenship on the low-risk list 1.0, medium list 0.7, otherwise 0.5 |

3. **Thresholds.** A score of 65 or more is approved. From 50 up to 65 goes to a person for review. Below 50 is declined.
4. **Pricing.** An approved loan gets the best band whose floor the score clears: band A at 80+ (9.49% APR), band B at 70+ (11.49%), band C at 65+ (13.49%). If the approve line is ever set below every band floor, the loan falls back to the lowest band instead of going out unpriced.
5. **Partner routing.** An approved loan goes to the partner that covers its destination: US to the US bank partner, CA to the Canada bank partner. If the destination rule is widened to a country with no partner, the result is marked `unroutable`: approved on score, sent to review because a person has to place it, and shown with provisional pricing.

## Policy tests and evals

A credit policy needs tests the same way a model needs evals. `npm test` runs 8 Vitest files, 245 tests in all, and they all pass. The suite is built in layers.

- **Golden cases** (`tests/golden.test.js`). `lib/scenarios.js` holds 21 applicants. Each one carries the outcome the default policy should give (decision, stage, and where it matters the band, score, failed rules or partner) plus a sentence showing the arithmetic, for example "10 + 8.3 + 20 + 3.3 + 6 + 7 = 54.6". Those expectations were worked out from the rules by hand before the engine was run, so the tests check the engine against the policy as written instead of against its own past output. The set covers each outcome, each price band, both partners, every knockout rule, and the inclusive edges (exactly $5,000, exactly $100,000, exactly 48 months).
- **Property checks** (`tests/invariants.test.js`). 600 random applicants from a fixed seed, so any failure can be replayed, are checked against rules that must hold for all of them: same input, same decision and trace, with no mutation of inputs; a score between 0 and 100 that equals the sum of its factors; more income, better credit, a better school or a smaller loan never lowers the score; switching an eligibility rule off never makes an outcome worse; an approval always carries a price and a partner, and a knockout always names the failed rule; a higher score never gets a higher rate; every enabled rule appears once in the trace. A further block checks that the reported score alone decides the threshold outcome, with a regression test for an old bug where a raw 64.96 was shown as 65 and sent to review.
- **Counterfactual checks** (`tests/counterfactual.test.js`, `tests/counterfactual-search.test.js`). Every suggestion for the golden set and 300 random applicants is confirmed by the engine. The search tests run a $1,000 to $1,000,000 program range, check the binary search against a linear scan, and assert it stays within a logarithmic number of engine runs.
- **API contract and fuzz tests** (`tests/api.test.js`). Valid requests with and without a policy; 405 with `Allow`; 413 for a declared or streamed body over 32 KB; 415 for a non-JSON content type; 400 for invalid JSON and for a table of invalid applicants and policies; 300 random malformed objects and 300 random byte streams that must all get a 200 or 400, never a 500 or a stack trace. It also covers the rate limit, the client-key precedence, and a spoofed `X-Forwarded-For` that cannot dodge the limit.
- **Supporting unit tests.** `tests/validate.test.js` (field messages, numeric strings, duplicate rules, pricing-band order), `tests/storage.test.js` (save, load, version resets, blocked storage) and `tests/impact.test.js` (known rule edits move exactly the expected golden cases, in the expected direction).
- **Accessibility and layout** (`tests/e2e/a11y.mjs`). Playwright drives a running server at 320, 390, 768 and 1366 pixels in light and dark mode, and runs axe (WCAG 2.0, 2.1 and 2.2, A and AA) on the three pages, each of the five preset results and the form's error state: 72 scans. It passes locally with no violations and no horizontal overflow.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci`, `npm test` and `npm run build`, then a second job that builds, starts the production server and runs the accessibility script.

The same golden set does a second job in the product. The rules console and the policy tests page run all 21 cases through the engine in the browser, against whatever policy you have edited, and compare each result with its hand-worked expectation. So a rule change shows its blast radius (who flips, in which direction, and how the approval count moves) before it is used for a single real decision. That is how rule changes should be governed in lending: nobody should ship a policy edit without first seeing which applicants it moves.

## Architecture

```
  Browser                                          Server (Vercel)
  +---------------------------------------+        +------------------------------+
  | Apply form -- zod applicant schema    |  POST  | /api/decide                  |
  | Rules console -- zod config schema    | -----> |  method, 60/min limit, JSON  |
  | Policy tests                          |  JSON  |  only, 32 KB cap, zod check  |
  |                                       |        |            |                 |
  | localStorage: edited policy           | <----- |  decide() + suggestChange()  |
  |                                       | result |  (lib/engine.js, pure)       |
  | decide() runs here too, for the       | +trace +------------------------------+
  | golden-case impact preview            |
  +---------------------------------------+
```

Next.js 15 with the pages router, React 18 and zod. There is no database and there are no secrets. The engine has no I/O, so the same module makes real decisions on the server and runs the impact preview in the browser, which means a simulated decision and a real one cannot drift apart. An edited policy lives in the visitor's `localStorage` and travels with each request, and the server validates it before using it. Every page is served with a strict Content Security Policy (same-origin scripts only, self-hosted fonts, no framing) and the usual hardening headers, and `npm audit` reports no known vulnerabilities.

More detail:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): requirements, data flow, the API contract, trust boundaries, testing strategy, and what would change at production scale.
- [ADR 0001](docs/adr/0001-deterministic-rules-engine.md): deterministic rules and a weighted scorecard instead of a machine learning model.
- [ADR 0002](docs/adr/0002-policy-held-in-the-browser.md): the edited policy is held in the browser and validated on every request.
- [ADR 0003](docs/adr/0003-policy-tests-as-evals.md): hand-derived policy tests, reused as a rule-change impact preview.

## Run locally

Requires Node 20 or later.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit, property and API tests (Vitest)
npm run build      # production build
```

The accessibility check drives a running server, so start one first and point the script at it:

```bash
npm run build && npm start
BASE_URL=http://localhost:3000 npm run test:a11y
```

The script uses Playwright, so the first run may need `npx playwright install chromium`.

## Known limitations

- **The rules are illustrative.** The thresholds, weights, bands, APRs, country lists and partners are made up for the demo. They are not any lender's credit policy and have not been validated against repayment data.
- **Policy edits live in your browser only.** They are saved to `localStorage`, nobody else sees them, and clearing site data or opening a private window brings back the defaults. A policy saved under an older version of the app (the current policy version is 2.1) is reset, with a notice. There is no shared policy, no approval step and no history of past versions.
- **The rate limit is in memory, per instance.** The API allows 60 requests a minute per client address, counted in the memory of whichever serverless instance handles the request. The address comes from the platform's own headers first, so a client cannot dodge the limit by rotating a fake `X-Forwarded-For`. It slows down a runaway script. It is not a real quota.
- **Scorecard weights are fixed in the UI.** The console shows the six weights but does not let you edit them. The API does accept custom weights, as long as they add up to 100.
- **Country risk uses citizenship as an illustrative proxy.** It is there to show how a scorecard factor works, not as a recommendation, and the rules console says so next to the weights. In a US-regulated product, any factor tied to national origin would need fair-lending review under the Equal Credit Opportunity Act (ECOA) and Regulation B before it could be used.
- **Declines explain themselves, but not in regulatory form.** The trace and reasons are written for people reading the demo. They are not formatted as adverse-action notices.

## Author

Subhasish Goswami, Senior Manager, Product. Portfolio: [subhasishgoswami.com](https://subhasishgoswami.com)

A personal prototype. All rules, scores, tiers and rates are illustrative, not any lender's actual credit policy.
