# Decision Studio: architecture

This document describes how Decision Studio is put together, why, and what would have to change before anything like it made real credit decisions. Decision Studio is a personal prototype. Every rule, weight, band and rate in it is illustrative.

## 1. Requirements

### Functional

- Take a student-loan application (citizenship, destination, degree level, field of study, school tier, months to graduation, loan amount, household income, credit history, years of work experience, admission confirmed) and return one of three decisions: approved, review or declined.
- Run a fixed pipeline: eligibility knockouts, a weighted scorecard, approve and review thresholds, risk-based pricing and partner routing.
- Explain every decision: the trace lists every rule checked and every factor scored, in order, and a knockout decline names every rule that failed.
- Tell the applicant what would change a non-approval, and only suggest changes the engine has confirmed.
- Let a visitor edit the policy (rules on and off, rule parameters, thresholds, pricing bands) without a deploy, and reset it in one step.
- Show the effect of a policy edit on a fixed set of test applicants before the edited policy is used.

### Non-functional

| Requirement | How it is met |
|---|---|
| Deterministic | `decide()` is a pure function of the applicant and the config. No clock, randomness, network or storage feeds into the outcome. The only time-based output is the timing in the trace. The score is rounded to one decimal once, and that same value drives thresholds, pricing and the response. |
| Explainable | The engine writes a trace entry at every step and returns the per-factor breakdown next to the score. |
| Fast | The engine does a handful of comparisons and six multiplications. Once warm, a call finishes in well under a millisecond on a laptop. The first call on a cold instance is slower. The UI shows engine time separately from round-trip time. |
| No secrets | Nothing in the app needs an API key, a credential or an environment variable. |
| No database | The default policy ships in the code. An edited policy lives in the visitor's browser. The server keeps nothing between requests except the rate-limit counters. |
| Safe to expose publicly | Rate limit before any parsing, JSON only, a 32 KB body cap, strict validation, bounded work per request, error responses that never include internals, and security headers on every page (section 5). |
| Accessible | Semantic HTML, labeled fields, keyboard operable with visible focus, a skip link, focus never hidden under the sticky header (scroll padding), an error summary that takes focus, a live status region for results, outcome icons so no status depends on color alone, reduced motion, light and dark themes. Checked with axe in CI (section 8). |

## 2. Components

```
+----------------------------- Browser ------------------------------+
|                                                                    |
|  pages/index.js        pages/rules.js         pages/evals.js       |
|  Apply form            Rules console          Policy tests         |
|  DecisionView          impact line                                 |
|       |                     |                     |                |
|       |          lib/usePolicy.js (shared hook)   |                |
|       |                     |                     |                |
|       |          lib/storage.js -- localStorage "ds-config"        |
|       |                                           |                |
|  lib/validate.js (zod)      lib/impact.js -- lib/scenarios.js      |
|       |                          |                                 |
|       |                     lib/engine.js (same module as server)  |
+-------+------------------------------------------------------------+
        |
        | POST /api/decide  { applicant, config? }
        v
+----------------------------- Server -------------------------------+
|  pages/api/decide.js                                               |
|    1. method check                                                 |
|    2. rate limit              (lib/ratelimit.js)                   |
|    3. content type, then read body with a 32 KB cap                |
|    4. zod validation          (lib/validate.js)                    |
|    5. decide()                (lib/engine.js)                      |
|    6. suggestChange()         (lib/counterfactual.js)              |
|  lib/defaults.js supplies the policy when none is sent             |
+--------------------------------------------------------------------+
```

| Module | Responsibility |
|---|---|
| `lib/engine.js` | The pure decision function. Five stages, a trace entry per step, no I/O. |
| `lib/defaults.js` | The default policy, versioned (`version: "2.1"`). |
| `lib/validate.js` | Zod schemas for the applicant, the policy and the request body. Used by the form, the rules console, browser storage and the API. |
| `lib/counterfactual.js` | Works out "what would change this decision" by re-running the engine. |
| `lib/scenarios.js` | The 21 golden applicants with hand-derived expected outcomes. Five of them double as presets on the Apply page. |
| `lib/impact.js` | Runs the golden applicants against a policy and compares each result with its expectation. |
| `lib/storage.js`, `lib/usePolicy.js` | Load, validate, save and reset the edited policy in `localStorage`, and share it across pages. |
| `lib/ratelimit.js` | Fixed-window, in-memory request limiter keyed by client address. |
| `next.config.js` | Security headers for every page, including the Content Security Policy. |
| `pages/api/decide.js` | The only server endpoint. |

## 3. Data flow

### A decision

1. The visitor submits the Apply form or picks a preset.
2. The browser parses the form with `applicantSchema`. If anything fails, the errors appear next to their fields and in a summary that takes focus, and no request is sent.
3. The browser sends `POST /api/decide` with `{ applicant }`. If the visitor has edited the policy, the edited policy goes along as `config`. With the default policy, `config` is left out and the server uses its own copy. The request times out after 10 seconds.
4. The server checks the method and applies the rate limit. Only then does it look at the body: it rejects a content type other than JSON, reads the body itself with a 32 KB cap (Next's body parser is switched off so this order holds), parses the JSON, and validates it with `decideRequestSchema`.
5. The server calls `decide(applicant, policy)` and then `suggestChange(applicant, policy, result)`. The suggestion reuses the result it was given and only re-runs the engine to search for a loan amount that would be approved. Because a smaller loan never lowers the score, the approving amounts form one range starting at the floor, so a binary search over round thousands, from the floor (the larger of $1,000 and the enabled minimum amount) up to just below the request, finds the largest one in a logarithmic number of engine runs.
6. The browser renders the decision, score gauge, factor breakdown, offer, reasons, suggestion and trace, and announces a one-sentence summary to screen readers. If the form changes afterward, the result is marked out of date.

### A rule edit

1. The visitor changes a value in the rules console. Number fields keep the raw text while it is typed and try to save only on Enter or when the field loses focus, so a half-typed value never becomes the live policy.
2. The console builds the next policy and parses it with `configSchema`. If it fails (a floor above the ceiling, a review line above the approve line, a better band priced above a worse one, and so on), the message appears next to the field with "Not saved; the rule still uses" and the current value, and nothing changes.
3. A valid policy is saved to `localStorage`. If it matches the defaults exactly, the key is removed instead.
4. The impact line reruns all 21 golden applicants against the new policy, in the browser, with the same `decide()` the server uses, and reports how many are decided differently and how approvals move. The policy tests page shows the row-by-row detail.
5. The next decision on the Apply page sends the edited policy with the request. Other open tabs pick up the change through the browser's `storage` event.

## 4. API contract: `POST /api/decide`

### Request

`Content-Type: application/json` (a charset parameter is fine, and a missing header is accepted). The body is a strict object: unknown keys are rejected at every level.

```json
{
  "applicant": {
    "citizenship": "IN",
    "destination": "US",
    "degreeLevel": "masters",
    "fieldOfStudy": "stem",
    "schoolTier": 1,
    "monthsToGraduation": 18,
    "loanAmount": 45000,
    "householdIncome": 30000,
    "creditHistory": "thin",
    "workExpYears": 3,
    "admitConfirmed": true
  },
  "config": { "...": "optional, same shape as lib/defaults.js" }
}
```

| Field | Rule |
|---|---|
| `citizenship`, `destination` | Two uppercase letters |
| `degreeLevel` | `masters`, `mba`, `phd` or `undergraduate` |
| `fieldOfStudy` | `stem`, `business`, `medicine`, `law` or `other` |
| `schoolTier` | Whole number, 1 to 4 (4 is unranked) |
| `monthsToGraduation` | Whole number, -120 to 120 |
| `loanAmount` | 0 to 1,000,000 |
| `householdIncome` | 0 to 100,000,000 |
| `creditHistory` | `established`, `thin` or `none` |
| `workExpYears` | 0 to 60 |
| `admitConfirmed` | Boolean |

Numeric fields also accept numeric strings, because that is what HTML form fields produce. Strings are trimmed, a blank string counts as missing (not zero), and only plain decimals are accepted, so hex, exponents and the like are rejected.

`config` is optional. When present, it must pass `configSchema`: 1 to 20 eligibility rules drawn from the six known rule ids, each id at most once, each with the parameters that rule needs; scorecard weights between 0 and 100 that add up to 100; field scores and degree multipliers between 0 and 1; review threshold at or below the approve threshold; 1 to 8 pricing bands with unique names, distinct minimum scores and APRs from 0 to 40, where the APR never rises as the minimum score rises; up to 20 partners. String and list lengths are capped throughout.

### Response, 200

```json
{
  "decision": "APPROVED | REVIEW | DECLINED",
  "stage": "eligibility | full-pipeline",
  "reasons": [{ "ruleId": "school-tier", "rule": "Minimum school tier", "reason": "..." }],
  "score": 79.4,
  "breakdown": [{ "factor": "School tier", "weight": 25, "points": 25 }],
  "pricing": { "band": "B", "apr": 11.49, "label": "Standard" },
  "partner": { "id": "partner-us", "name": "US Bank Partner" },
  "unroutable": false,
  "trace": [{ "step": "eligibility", "detail": "PASS: Admission confirmed", "elapsedMs": 0.01 }],
  "totalMs": 0.05,
  "suggestion": null
}
```

- `stage` is `eligibility` when a knockout rule declined the application. Then `reasons` lists every failed rule, `score`, `breakdown`, `pricing` and `partner` are `null`, and `unroutable` is `false`.
- `stage` is `full-pipeline` otherwise. `reasons` is empty and `score` is rounded to one decimal; that rounded value is the one the thresholds and pricing used. `pricing` and `partner` are set for an approval.
- `unroutable` is `true` when the score cleared the approve line but no partner covers the destination. The decision is then `REVIEW`, `partner` is `null`, and `pricing` holds the provisional band the score earned.
- `trace[].step` is one of `intake`, `eligibility`, `scorecard`, `decision`, `pricing`, `routing`, `complete`.
- `suggestion` is `null` for an approval. Otherwise it has a `kind`:

| `kind` | When | Payload |
|---|---|---|
| `eligibility` | A knockout rule declined it | `fixes[]` with `ruleId`, `rule`, `hint` (a destination hint names the accepted countries), plus a `note` that clearing the rules does not guarantee approval |
| `routing` | `unroutable` is `true` | `hint` |
| `amount` | A lower loan amount would be approved | `amount` (the largest round thousand below the request that the engine approves), `score`, `band`, `apr`, `pointsNeeded` |
| `gap` | Even the minimum amount would not be approved | `floor`, `pointsNeeded`, and the weakest `factor` with its `points` and `weight` |

Only the loan amount is treated as a lever the applicant controls. School, credit history and income are reported as the gap, not as advice.

### Errors

| Status | When | Body |
|---|---|---|
| 400 | The body is not valid JSON | `{ "error": "Request body is not valid JSON." }` |
| 400 | The body fails the schema (missing field, wrong type, out of range, unknown key, invalid policy). An empty body is treated as `{}` and fails here. | `{ "error": "Invalid request", "issues": [{ "path": "applicant.loanAmount", "message": "..." }] }`, at most 10 issues |
| 405 | Any method other than POST | `{ "error": "Use POST with a JSON body." }` and `Allow: POST` |
| 413 | A declared `Content-Length` over 32 KB (rejected without reading), or a body that passes 32 KB while it streams | `{ "error": "Request body is larger than 32 KB." }` |
| 415 | A `Content-Type` is present and is not `application/json` | `{ "error": "Send the body as application/json." }` |
| 429 | More than 60 requests in the current one-minute window from the same client | `{ "error": "Too many requests. Try again in a minute." }` and `Retry-After` in seconds |
| 500 | The engine throws | `{ "error": "The decision engine hit an unexpected error." }`. Details go to the server log only. |

Every error is JSON in the same shape, because the handler reads the body itself instead of leaving bad JSON or oversized bodies to the framework.

### Headers

- `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on every response.
- `X-RateLimit-Limit: 60` and `X-RateLimit-Remaining` on every response that gets past the method check, including 400, 413 and 415.
- `Retry-After` on a 429.
- `Allow: POST` on a 405.

## 5. Trust boundaries

The browser is untrusted, and so is anything it sends, including the policy.

- **The policy comes from the client.** That is a deliberate choice (see [ADR 0002](adr/0002-policy-held-in-the-browser.md)), and it means the server must treat `config` as hostile input. It parses it with the same `configSchema` the rules console uses. The schema is strict, so extra keys fail. Rule ids must be known, which keeps the engine on code paths that exist. Numbers must be finite and inside their ranges, weights must add up to 100 and thresholds must be in order, so the engine cannot be pushed outside the range it was built for.
- **The work per request is bounded.** The body is capped at 32 KB, lists in the policy are capped, and the counterfactual search needs a logarithmic number of engine runs however wide the amount range is (about a dozen for $1,000 to $1,000,000).
- **Requests are rate limited before anything is parsed.** 60 a minute per client, in memory, and invalid requests count too, so a script cannot probe for free. The client key comes from `x-vercel-forwarded-for`, then `x-real-ip`, then the first `X-Forwarded-For` entry, then the socket address. On Vercel the first two are set by the platform, so rotating a spoofed `X-Forwarded-For` does not reset the count. On serverless the counter is per warm instance, so it slows a runaway script rather than enforcing a hard quota. That is proportionate here because the engine is cheap and holds no data worth protecting.
- **Nothing leaks.** Validation errors return the path and message only. Unexpected errors return a fixed message and log the detail on the server.
- **Nothing is stored.** The server keeps no applicant data and no policy. The rate limiter holds client addresses in memory for at most the length of the window and caps the number of keys.
- **The pages are locked down.** `next.config.js` sends a Content Security Policy on every page: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (needed for the React style props on the score bars), fonts self-hosted, `object-src 'none'` and `frame-ancestors 'none'`. It also sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a `Permissions-Policy` that turns off camera, microphone and location. The `X-Powered-By` header is removed. Dependencies are pinned (Next 15.5.26, with a `postcss` override) and `npm audit` reports no known vulnerabilities.

## 6. One engine, two places

`lib/engine.js` has no imports and no side effects. The server imports it to make decisions. The browser imports the same file to run the golden applicants for the impact preview and the policy tests page. Because it is the same function with the same inputs, a simulated outcome in the rules console is exactly the outcome the API would return for that applicant under that policy. There is no second implementation that could drift.

The same idea applies to validation. `lib/validate.js` runs in the form, in the rules console, when a saved policy is loaded from storage, and in the API. A request the UI would refuse, the API refuses too.

## 7. State and persistence

- The only persisted state is the edited policy, stored under one `localStorage` key, `ds-config`.
- Every page reads the policy through `usePolicy()`. It starts from the defaults, which matches the server render, and loads the stored policy after mount.
- On load the stored value is parsed with `configSchema` and its `version` is compared with the version in `lib/defaults.js`. If either check fails, the stored policy is removed, the defaults are used, and the visitor sees a notice that the saved rules could not be read and were reset. Bumping the version is how a change invalidates old saved policies: version 2.1, for example, moved the UK destination code from `UK` to the ISO code `GB`.
- Every storage call is wrapped, because storage can be missing, full or blocked. If a save fails, the rules console says so, since the Apply page would not see the edit.
- Saving a policy that matches the defaults removes the key, so "edited" always means "different from the defaults".

## 8. Testing strategy

The tests are shaped like a pyramid, with the cheapest and most numerous checks at the bottom. `npx vitest run` runs 8 files and 245 tests, all passing.

1. **Golden cases (unit), `tests/golden.test.js`.** The 21 applicants in `lib/scenarios.js`, with expectations worked out by hand from the written policy. The engine must match each one on decision and stage, and on band, exact score, failed rules (in order) or partner where the case states them. These pin the policy as written.
2. **Properties (unit), `tests/invariants.test.js`.** 600 applicants generated from a fixed seed (`tests/helpers/random.js`, a small mulberry32 generator), checked against invariants that must hold for every input: determinism and no mutation of inputs; a score between 0 and 100 that equals the sum of its factors; monotonicity (more income, better credit, a better school or a smaller loan never lowers the score); switching an eligibility rule off never worsens an outcome, under the default policy and with every rule on; an approval always has a price and a partner and a knockout names its rule; a higher score never gets a higher rate; every enabled rule appears once in the trace. A further block checks that the reported score alone decides the threshold outcome. It includes a regression test for a fixed bug where a raw 64.96 was reported as 65 but compared unrounded and sent to review.
3. **Counterfactual (unit), `tests/counterfactual.test.js` and `tests/counterfactual-search.test.js`.** Every suggestion for the golden set and 300 random applicants is confirmed by re-running the engine, and each suggestion kind is exercised. The search tests use a $1,000 to $1,000,000 range, compare the binary search with a linear scan on 200 random applicants, count engine runs to prove the search stays logarithmic, and check that the floor follows only an enabled amount rule.
4. **Supporting units.** `tests/validate.test.js` (field messages, numeric-string handling, unknown keys, duplicate rule ids, pricing-band order and shared floors), `tests/storage.test.js` (load, save, reset, version mismatch, blocked or throwing storage) and `tests/impact.test.js` (known rule edits move exactly the expected golden cases, in the expected direction).
5. **API contract and fuzz (integration), `tests/api.test.js`.** The handler is called with mock request and response objects, including a stream path that feeds the body through a `Readable` so the handler's own reader runs. Covered: valid requests with and without a policy; 405; 415 for non-JSON content types; 400 for invalid JSON and for a table of invalid applicants and policies with the exact issue path each should report; 413 for a declared length, a streamed body and a pre-read string over 32 KB, with exactly 32,768 bytes still accepted; bodies split across many chunks; 300 random malformed objects and 300 random byte streams, which must all get a 200 or 400 with no stack trace. The rate limit is tested too (the 61st request gets a 429 with `Retry-After`, other clients are unaffected, invalid requests count), along with the client-key precedence and a spoofed `X-Forwarded-For` that cannot escape the limit.
6. **Accessibility and layout (end to end), `tests/e2e/a11y.mjs`.** Playwright drives Chromium against a running server at four widths (320, 390, 768, 1366) in light and dark mode. On each of the three pages, after each of the five preset decisions and in the form's error state, it runs axe with the WCAG 2.0, 2.1 and 2.2 A and AA rule tags and fails on any violation or horizontal overflow. That is 72 scans; the latest local run found no violations and no overflow.

CI (`.github/workflows/ci.yml`) runs on every push and pull request. The first job runs `npm ci`, `npm test` and `npm run build`. The second job, which only runs if the first passes, installs Chromium, builds, starts the production server and runs the accessibility script.

The golden set is also a product feature: the rules console and the policy tests page use it to preview a rule change. [ADR 0003](adr/0003-policy-tests-as-evals.md) explains why the expectations are hand-derived rather than snapshots of engine output.

## 9. What changes at production scale

Decision Studio skips everything a real lender would need around the engine. This is the list to revisit, roughly in the order it would matter.

- **A versioned policy service with approvals.** Policies stored server-side as immutable, numbered versions. A decision records the policy version it ran under. No policy comes from the client.
- **Maker-checker.** The person who drafts a policy change cannot be the person who approves it. Approval is recorded with names and time.
- **An audit log of policy versions.** Who changed what, when, why, and which version was live at any moment, kept for as long as the lender's record-keeping rules require.
- **Champion/challenger and backtesting.** Before a rule goes live, run it against a large set of historical applications, compare approvals, pricing and expected losses with the current policy, and if it passes, run it on a slice of live traffic next to the champion. The 21 golden cases stay as a regression suite. They do not replace a backtest.
- **Shared rate limiting and real abuse protection.** A shared store for limits, authentication for callers, and protection at the edge, instead of per-instance memory.
- **Observability.** Structured logs, a decision record per application, latency and error metrics, and alerts on shifts in decision mix, approval rate or band distribution after a policy change.
- **Adverse-action reason codes.** Declines mapped to standard, ranked principal reasons suitable for adverse-action notices, instead of free-text trace lines.
- **Fair-lending review.** Every factor and every rule reviewed for disparate treatment and disparate impact before use, with ongoing monitoring. The country-risk factor in this demo uses citizenship as an illustrative proxy, and the rules console carries a note saying so. In a US-regulated product, anything tied to national origin would need review under ECOA and Regulation B before it could be used at all.
- **Model governance if machine learning is ever added.** Documentation, independent validation, performance and drift monitoring, and explainability that still produces specific decline reasons. See [ADR 0001](adr/0001-deterministic-rules-engine.md).
- **Data inputs.** Real applications need verified data (bureau pulls, income and document checks, school lists) with their own failure modes, retries and timeouts. The engine should stay pure; the data fetching belongs in a layer in front of it.
