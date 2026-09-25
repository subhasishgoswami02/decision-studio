# ADR 0004: Decide in the browser, confirm on the server

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The Apply page used to be a form with a submit button: fill it in, send it, wait for the answer. The point of the demo is to show how each input moves a decision, and a submit step hides that. Moving a slider should change the result as the slider moves.

The engine is a pure function with no imports that runs in well under a millisecond once warm, and it already runs in the browser for the rules-change impact preview. The API is public, rate limited to 60 requests a minute per client, and served from serverless functions.

## Decision

Every input change is decided in the browser with the same `decide()` and `suggestChange()` the server uses, and the result renders immediately. Once the inputs have been still for 500 ms, the page sends them to `POST /api/decide`. It compares the server's answer with its own and says "Confirmed by the decision API in N ms". A newer change cancels a pending request. If the API is unreachable or rate limited, the page keeps the browser's result and says that is what it is showing. A mismatch is reported as an error.

## Options considered

| Option | Feedback while editing | API requests | Server in the loop | Works if the API is down |
|---|---|---|---|---|
| API only, called per change with a debounce | Waits for the debounce plus a round trip | One per pause | Yes, for every result | No |
| **Browser first, API confirms after a pause** (chosen) | Instant | One per pause | Yes, as a check | Yes, with a label saying so |
| Browser only | Instant | None | No | Yes |

## Trade-offs

- **Gained:** instant feedback on every change, including slider drags, without sending a request per step. A visitor would have to pause more than 60 times in a minute to reach the rate limit. The API still has a visible job, and the page shows its timing.
- **Given up:** the result on screen comes from code running in the visitor's browser, which the visitor can change. Here that is acceptable: the server validates everything it receives and decides again from the inputs, it never accepts a decision from the client, and nothing in the demo has stakes. A tampered browser can only fool its own screen.
- **Cost:** two places render a decision, so they must agree. That is why the engine is one pure module shared by both, and why the page checks the server's answer against its own on every settled change.

## Consequences

- The "no second implementation" property now covers the main page as well as the impact preview. The live result, the rules-console simulation and the API answer are the same function applied to the same inputs.
- The screen-reader status line announces the outcome after the confirmation settles, not on every slider step.
- The accessibility script covers the live states: a keyboard slider change, an opened pipeline step and a field error, as well as the sample results.

## What we would revisit

In a production lending system the server's decision is the only one of record. A browser-side result could still be shown as a preview, clearly labeled, but the offer, the price and any notice to the applicant would come from the server, stored with the policy version it ran under. Confirmation would be required before any action, not a background check. The browser would also stop receiving the full policy, since a real credit policy is not something to ship to every visitor.
