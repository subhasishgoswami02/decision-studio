// Policy tests: run the golden applicants against a configuration and compare
// with the outcome each one should get under the default policy.
// With the default policy every case should match; with edited rules the
// changed cases are the blast radius of the edit.
import { decide } from "./engine.js";
import { SCENARIOS } from "./scenarios.js";

export function outcomeOf(result) {
  return {
    decision: result.decision,
    band: result.pricing?.band ?? null,
    score: result.score,
    stage: result.stage,
  };
}

export function label(o) {
  if (!o) return "";
  if (o.decision === "APPROVED") return o.band ? `Approved, band ${o.band}` : "Approved";
  if (o.decision === "REVIEW") return "Sent to review";
  return o.stage === "eligibility" ? "Declined, ineligible" : "Declined";
}

export function runPolicyTests(config, scenarios = SCENARIOS) {
  const rows = scenarios.map((s) => {
    const actual = outcomeOf(decide(s.applicant, config));
    const expected = {
      decision: s.expect.decision,
      band: s.expect.band ?? null,
      stage: s.expect.stage,
    };
    const match =
      actual.decision === expected.decision &&
      actual.stage === expected.stage &&
      (expected.decision !== "APPROVED" || !expected.band || actual.band === expected.band);
    return { scenario: s, expected, actual, match, direction: direction(expected, actual) };
  });
  const count = (fn) => rows.filter(fn).length;
  return {
    rows,
    total: rows.length,
    matched: count((r) => r.match),
    changed: count((r) => !r.match),
    approvalsExpected: count((r) => r.expected.decision === "APPROVED"),
    approvalsActual: count((r) => r.actual.decision === "APPROVED"),
  };
}

const RANK = { DECLINED: 0, REVIEW: 1, APPROVED: 2 };
const BAND_RANK = { A: 3, B: 2, C: 1 };

// "better" | "worse" | "same" from the applicant's point of view.
function direction(expected, actual) {
  const d = RANK[actual.decision] - RANK[expected.decision];
  if (d > 0) return "better";
  if (d < 0) return "worse";
  if (actual.decision === "APPROVED" && expected.band && actual.band !== expected.band) {
    const b = (BAND_RANK[actual.band] ?? 0) - (BAND_RANK[expected.band] ?? 0);
    return b > 0 ? "better" : b < 0 ? "worse" : "same";
  }
  return "same";
}
