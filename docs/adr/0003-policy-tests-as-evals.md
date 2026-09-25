# ADR 0003: Policy tests as evals, reused as a rule-change impact preview

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

A credit policy is code that decides who gets a loan and at what price. Two kinds of change can move those decisions:

- a code change to the engine, which should never move a decision unless the policy was meant to change;
- a policy change (a threshold, a rule, a band), which is meant to move some decisions, and the question is which ones.

Both need a check that runs before the change is used. The second one needs that check to be visible to whoever is changing the policy, not only to CI.

## Decision

Keep a golden set of 21 applicants in `lib/scenarios.js`. Each case states the outcome the default policy should give (decision and stage, plus band, score, failed rules or partner where they matter) and a sentence showing the arithmetic. The expectations were worked out by hand from the written policy before the engine was run.

Use the set in two places:

1. **In CI**, the engine must reproduce every expectation under the default policy. Alongside it, property checks on generated applicants test invariants that must hold for any input (determinism, score bounds, monotonicity, knockouts never worsening an outcome when switched off, approvals always priced and routed, higher scores never priced higher).
2. **In the product**, the rules console and the policy tests page run the same 21 cases against the visitor's edited policy, in the browser, with the same engine, and show which cases would now be decided differently, whether each change is better or worse for the applicant, and how the approval count moves.

## Options considered

| Option | Catches engine regressions | Catches a wrong policy implementation | Explains itself | Maintenance |
|---|---|---|---|---|
| **Hand-derived golden cases plus properties** (chosen) | Yes | Yes, the expectation comes from the policy, not the code | Yes, each case carries its arithmetic | Update by hand when the default policy changes |
| Snapshot the engine's current output | Yes | No, a bug present when the snapshot was taken becomes the expected answer | No | Low, and that is the problem: re-recording is easy and unreviewed |
| Properties only | Some | Partly | No specific cases to point at | Low |
| Backtest on historical applications | Yes | Partly | In aggregate | Needs real data, which this project does not have |

## Trade-offs

- **Why hand-derived.** A snapshot test tells you the engine still does what it did yesterday. It cannot tell you it does what the policy says. Writing the expectation first, from the rules and weights, means a mistake in the engine shows up as a failing case instead of being recorded as correct. The arithmetic in each case also makes a failure easy to diagnose.
- **Why properties as well.** Twenty-one cases pin 21 points. Properties cover the space between them, for example that raising income can never lower a score, which a fixed list cannot promise.
- **Cost.** When the default policy changes on purpose, the affected expectations have to be worked out again by hand. That is deliberate friction: the diff to `lib/scenarios.js` is the reviewable record of which decisions the change was meant to move.

## Consequences

- A code change that shifts any golden decision fails CI.
- A policy edit in the console shows its blast radius immediately, before it is used for a decision. That is the habit a lending team should have for any rule change: see who moves, in which direction, and how approvals shift, then decide.
- Because the preview runs the same engine as the API, there is no gap between what the preview says and what the API would do for those applicants.

## What we would revisit (and the limits that make it necessary)

- **21 cases are not a backtest.** They are chosen to cover each outcome, each band, both partners, every knockout rule and the inclusive edges. They say nothing about how a change would shift approval rates, pricing mix or losses across a real applicant population. Before a rule went live in production, it would need a backtest on a large set of historical applications and a champion/challenger run on live traffic.
- The approval count in the preview is a count of test cases, not a rate. It should not be read as a forecast.
- The expectations are for the default policy only. An edited policy has no expectations of its own; the preview reports differences from the default, not correctness.
- With real data, the golden set would grow from production edge cases and incidents, and each new case would still be written down with its expected outcome before it was run.
