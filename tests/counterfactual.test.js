// "What would change this decision?" Every suggestion must be one the engine
// confirms, and an amount suggestion must be the largest round-thousand amount
// below the request that gets approved.
import { describe, it, expect } from "vitest";
import { decide } from "../lib/engine.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { SCENARIOS, scenarioById } from "../lib/scenarios.js";
import { suggestChange } from "../lib/counterfactual.js";
import { randomApplicants, clone } from "./helpers/random.js";

// Effective search floor: max(1000, the enabled amount-range floor).
const FLOOR = Math.max(1000, DEFAULT_CONFIG.eligibilityRules.find((r) => r.id === "amount-range").params.minAmount);

const pool = [...SCENARIOS.map((s) => s.applicant), ...randomApplicants(777, 300)];

function checkSuggestion(a, cfg = DEFAULT_CONFIG) {
  const result = decide(a, cfg);
  const s = suggestChange(a, cfg, result);
  if (result.decision === "APPROVED") {
    expect(s).toBeNull();
    return "approved";
  }
  if (result.stage === "eligibility") {
    expect(s.kind).toBe("eligibility");
    expect(s.fixes.map((f) => f.ruleId)).toEqual(result.reasons.map((r) => r.ruleId));
    for (const f of s.fixes) {
      expect(typeof f.hint).toBe("string");
      expect(f.hint.length).toBeGreaterThan(0);
      expect(f.rule).toBeTruthy();
    }
    return "eligibility";
  }
  // Scored, not approved.
  expect(["amount", "gap", "routing"]).toContain(s.kind);
  if (s.kind === "amount") {
    const requested = Number(a.loanAmount);
    expect(s.amount % 1000).toBe(0);
    expect(s.amount).toBeLessThan(requested);
    expect(s.amount).toBeGreaterThanOrEqual(FLOOR);
    const at = decide({ ...a, loanAmount: String(s.amount) }, cfg);
    expect(at.decision).toBe("APPROVED");
    expect(s.score).toBe(at.score);
    expect(s.band).toBe(at.pricing.band);
    expect(s.apr).toBe(at.pricing.apr);
    const next = s.amount + 1000;
    if (next >= FLOOR && next <= requested) {
      expect(decide({ ...a, loanAmount: String(next) }, cfg).decision).not.toBe("APPROVED");
    }
  }
  if (s.kind === "gap") {
    const gaps = result.breakdown.map((b) => b.weight - b.points);
    const max = Math.max(...gaps);
    const named = result.breakdown.find((b) => b.factor === s.factor);
    expect(named).toBeTruthy();
    expect(named.weight - named.points).toBeCloseTo(max, 9);
    expect(s.weight).toBe(named.weight);
    expect(s.pointsNeeded).toBeGreaterThan(0);
    expect(s.floor).toBe(FLOOR);
    // Gap means nothing from the floor up to the request approves.
    if (FLOOR < Number(a.loanAmount)) {
      expect(decide({ ...a, loanAmount: String(FLOOR) }, cfg).decision).not.toBe("APPROVED");
    }
  }
  if (s.kind === "routing") {
    // Only honest when the engine flagged the result as unroutable.
    expect(result.unroutable).toBe(true);
    expect(cfg.partnerRouting.some((p) => p.destinations.includes(a.destination))).toBe(false);
  } else {
    expect(result.unroutable).toBe(false);
  }
  return s.kind;
}

describe("suggestChange", () => {
  it("every suggestion over the golden set and 300 random applicants is confirmed by the engine", () => {
    const kinds = {};
    for (const a of pool) {
      const k = checkSuggestion(a);
      kinds[k] = (kinds[k] || 0) + 1;
    }
    // The pool should exercise every path the default policy can reach.
    expect(kinds.approved).toBeGreaterThan(0);
    expect(kinds.eligibility).toBeGreaterThan(0);
    expect(kinds.amount).toBeGreaterThan(0);
    expect(kinds.gap).toBeGreaterThan(0);
  });

  it("approved results get null", () => {
    for (const s of SCENARIOS.filter((x) => x.expect.decision === "APPROVED")) {
      expect(suggestChange(s.applicant, DEFAULT_CONFIG)).toBeNull();
    }
  });

  it("eligibility declines get one fix per failed rule", () => {
    const s = scenarioById("ineligible-multi");
    const out = suggestChange(s.applicant, DEFAULT_CONFIG);
    expect(out.kind).toBe("eligibility");
    expect(out.fixes.map((f) => f.ruleId)).toEqual(["supported-destination", "admit-confirmed", "school-tier"]);
    expect(out.fixes[0].hint).toBe("Choose an accepted destination: United States, Canada.");
    expect(out.fixes[2].hint).toBe("Choose a school at tier 3 or better.");
    expect(out.note).toBeTruthy();
  });

  it("destination hint uses country names, and says so when no destination is accepted", () => {
    const a = scenarioById("unsupported-destination").applicant;
    const gb = clone(DEFAULT_CONFIG);
    gb.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations = ["CA", "GB", "US"];
    const us = { ...a, destination: "IN" };
    expect(suggestChange(us, gb).fixes[0].hint).toBe("Choose an accepted destination: Canada, United Kingdom, United States.");

    const none = clone(DEFAULT_CONFIG);
    none.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations = [];
    expect(suggestChange(a, none).fixes[0].hint).toBe("No destinations are accepted under the current rules.");
  });

  it("gives the amount hints for below-floor and above-ceiling requests", () => {
    expect(suggestChange(scenarioById("amount-below-floor").applicant, DEFAULT_CONFIG).fixes[0].hint).toBe(
      "Request at least $5,000."
    );
    expect(suggestChange(scenarioById("amount-above-ceiling").applicant, DEFAULT_CONFIG).fixes[0].hint).toBe(
      "Request $100,000 or less."
    );
  });

  it("borderline-review preset suggests $14,000", () => {
    const out = suggestChange(scenarioById("borderline-review").applicant, DEFAULT_CONFIG);
    expect(out).toMatchObject({ kind: "amount", amount: 14000 });
  });

  it("low-score-decline preset suggests $11,000", () => {
    const out = suggestChange(scenarioById("low-score-decline").applicant, DEFAULT_CONFIG);
    expect(out).toMatchObject({ kind: "amount", amount: 11000 });
  });

  it("names the largest gap when no amount inside the limits gets to approval", () => {
    // Tier 3, other field, no credit, no income: no amount reaches 65.
    const a = {
      ...scenarioById("borderline-review").applicant,
      creditHistory: "none",
      householdIncome: "0",
      workExpYears: "0",
      citizenship: "XX",
    };
    const result = decide(a, DEFAULT_CONFIG);
    expect(result.stage).toBe("full-pipeline");
    const out = suggestChange(a, DEFAULT_CONFIG, result);
    expect(out.kind).toBe("gap");
    // Income coverage at 0 of 20 is the biggest shortfall.
    expect(out.factor).toBe("Income coverage");
    expect(out.points).toBe(0);
    expect(out.weight).toBe(20);
    expect(out.floor).toBe(5000);
    checkSuggestion(a);
  });

  it("reports routing when the score clears the line but no partner covers the destination", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations.push("GB");
    const a = scenarioById("unsupported-destination").applicant;
    const result = decide(a, cfg);
    expect(result.decision).toBe("REVIEW");
    expect(result.unroutable).toBe(true);
    expect(suggestChange(a, cfg, result).kind).toBe("routing");
    checkSuggestion(a, cfg);
  });

  // Regression: raw 64.96 used to be reported as 65 and sent to review, and
  // the suggestion then claimed no partner covered the US.
  it("regression: a US applicant at a reported 65 is approved and gets no suggestion", () => {
    const a = {
      citizenship: "IN",
      destination: "US",
      degreeLevel: "masters",
      fieldOfStudy: "stem",
      schoolTier: "1",
      monthsToGraduation: "18",
      loanAmount: "45000",
      householdIncome: "10000",
      creditHistory: "none",
      workExpYears: "1",
      admitConfirmed: true,
    };
    const result = decide(a, DEFAULT_CONFIG);
    expect(result).toMatchObject({ decision: "APPROVED", score: 65, unroutable: false });
    expect(suggestChange(a, DEFAULT_CONFIG, result)).toBeNull();
    // One step past the line (a larger loan), the suggestion is an amount, never routing.
    const b = { ...a, loanAmount: "46000" };
    const rb = decide(b, DEFAULT_CONFIG);
    expect(rb.decision).toBe("REVIEW");
    expect(suggestChange(b, DEFAULT_CONFIG, rb)).toMatchObject({ kind: "amount", amount: 45000 });
  });

  it("never suggests routing for a routable destination under the accept-GB policy either", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations.push("GB");
    for (const a of pool) checkSuggestion(a, cfg);
  });
});
