# ADR 0002: The edited policy is held in the visitor's browser and validated on every request

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The rules console lets anyone on the public internet edit the credit policy: switch rules on and off, change the loan limits, destinations and enrollment window, move the thresholds, and edit pricing bands. The next decision has to use those edits.

Constraints:

- It is a public demo with no sign-in. One visitor's edits must never change what another visitor sees.
- It runs on serverless functions. There is no database, and adding one would add cost, secrets and something to keep alive.
- Anything a visitor can edit, a visitor can also forge by hand.

## Decision

The edited policy is saved in the visitor's `localStorage` and sent with each decision request as `config`. When the policy is unchanged, the browser sends no `config` and the server uses the defaults from `lib/defaults.js`. The server parses any `config` it receives with the same strict zod schema the rules console uses (`configSchema` in `lib/validate.js`) and rejects it with a 400 if it fails. A stored policy is validated again when it is loaded, and it is discarded if its version does not match the current defaults.

## Options considered

| Option | Isolation between visitors | Infrastructure | Trust | Shared or audited |
|---|---|---|---|---|
| **Browser storage, sent per request, validated on the server** (chosen) | Complete, by construction | None | Config is untrusted, so it must be validated | No |
| Server-side store keyed by an anonymous session | Depends on the session handling being right | Database or key-value store, plus cleanup | Config trusted once stored | Could be |
| Accounts plus a server-side policy store | Per account | Database, auth, secrets | Trusted after authentication | Yes |
| URL-encoded policy | Complete | None | Untrusted | No, and URLs get long |

## Trade-offs

- **Gained:** no accounts, no database, no secrets, and no way for one visitor's edits to leak into another visitor's decisions. The server stays stateless apart from rate-limit counters.
- **Given up:** the policy is not shared. It does not follow the visitor to another browser, and it disappears in a private window or when site data is cleared. There is no history of versions and no approval step.
- **Cost:** the server has to treat the policy as hostile input. The schema is strict (unknown keys fail), rule ids are limited to the six the engine knows and may appear once each, every number is bounded, weights must add up to 100, the review line must sit at or below the approve line, pricing bands need distinct floors and an APR that never rises as the floor rises, and list lengths are capped. The request body is limited to 32 KB, and requests are rate limited before the body is read.

## Consequences

- The validation schema is shared between the browser and the server, so the rules console cannot save a policy the API would reject, and a hand-written request cannot push the engine outside its tested range.
- Bumping `version` in `lib/defaults.js` resets every visitor's saved policy the next time they load the page, with a notice. That is the migration path when the policy changes shape or meaning. Version 2.1 used it when the UK destination code moved from `UK` to the ISO code `GB`.
- The API accepts some settings the console does not expose, such as custom scorecard weights, as long as they validate.

## What we would revisit

In a real lending system, a policy must never come from the client. It would live in a versioned policy service:

- each version immutable and numbered, with every decision recording the version it ran under;
- changes drafted by one person and approved by another (maker-checker);
- an audit log of who changed what and when;
- a new version backtested on historical applications and run as a challenger before it replaces the current policy.

The browser would then send only the application, and the rules console would become an authoring tool that submits drafts for approval.
