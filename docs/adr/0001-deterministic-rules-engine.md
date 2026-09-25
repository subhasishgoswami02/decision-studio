# ADR 0001: Deterministic rules and a weighted scorecard instead of a machine learning model

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Decision Studio exists to show how a student-loan decision can be made quickly, explained completely and changed safely. The engine has to:

- return the same answer every time for the same application and policy;
- explain every decision step by step, including every rule a declined application failed;
- give a declined applicant specific reasons, in the spirit of an adverse-action notice;
- be testable against outcomes a person can work out on paper;
- let a non-engineer change the policy and see the effect straight away.

There is no historical loan performance data behind this project, and it is a public demo with no one monitoring it.

## Decision

The engine is a pure function, `decide(applicant, config)`, that runs fixed stages in order: eligibility knockout rules, a weighted scorecard of six factors (weights 25, 15, 20, 20, 10, 10), approve and review thresholds (65 and 50 by default), pricing bands, and partner routing. Every stage writes to a trace. There is no machine learning in it: every score is a sum of weights times factor values that are written down in `lib/defaults.js` and `lib/engine.js`.

## Options considered

| Option | Explainability | Testability | Needs data | Change without a deploy | Governance load |
|---|---|---|---|---|---|
| **Rules plus weighted scorecard** (chosen) | Complete: every point traceable to a factor and a weight | Expected outcomes can be derived by hand | No | Yes, parameters are config | Low |
| Machine learning model (for example gradient-boosted trees) | Needs post-hoc attribution, which is approximate | Only statistical tests, no hand-derived answers | Yes, labeled repayment history | Retraining, not config | High: validation, monitoring, drift |
| Hybrid: rules for knockouts, model for the score | Knockouts clear, score not | Partly | Yes | Partly | High |

## Trade-offs

- A hand-set scorecard is only as good as the judgment behind it. A model trained on good data would likely rank risk better. That advantage is not available here, since there is no data, and it would not be demonstrable in a public demo anyway.
- Linear weights miss interactions (for example, credit history mattering more for larger loans). The field-of-study factor multiplies field by degree level, which is the one interaction built in.
- The rules are simple enough to read, which also means they are simple enough to game. For a demo that is acceptable.

## Consequences

- The trace is exact, not an approximation. Every point of a score can be pointed at.
- Declines carry the rule or factor behind them, which is the raw material for adverse-action reasons.
- The golden test cases can state expected scores to one decimal place, worked out by hand (see [ADR 0003](0003-policy-tests-as-evals.md)).
- The counterfactual ("borrow $14,000 instead and this is approved") is found by re-running the engine, which is cheap and exact because the engine is deterministic. Because a smaller loan never lowers the score, a binary search finds the largest approving amount in a handful of runs.
- The score is rounded to one decimal once, and that value drives the thresholds, pricing and what the applicant sees, so the displayed number is always the one that decided.
- The same function can run in the browser for impact previews and on the server for decisions (see [ARCHITECTURE.md](../ARCHITECTURE.md)).

## What we would revisit

- If real repayment data became available, a model could be tested as a challenger to the scorecard, with the knockout rules kept as they are. That would bring model governance with it: documentation, independent validation, monitoring for drift and performance, and an explanation method that still produces specific, ranked decline reasons.
- Scorecard weights and factor tables should be fitted to outcomes, not set by hand, before any real use.
- Any factor tied to a protected characteristic or a proxy for one, such as the illustrative country-risk factor based on citizenship, would need fair-lending review under ECOA and Regulation B before use, whichever approach is chosen.
