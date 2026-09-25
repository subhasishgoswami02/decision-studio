// The amount search must find the largest approving round-thousand amount
// however wide the program range is, in O(log n) engine runs.
// The engine is wrapped only to count calls; its behavior is unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/engine.js", async (importOriginal) => {
  const mod = await importOriginal();
  const calls = { n: 0 };
  return {
    ...mod,
    __calls: calls,
    decide: (...args) => {
      calls.n++;
      return mod.decide(...args);
    },
  };
});

const engine = await import("../lib/engine.js");
const { suggestChange } = await import("../lib/counterfactual.js");
const { DEFAULT_CONFIG } = await import("../lib/defaults.js");
const { randomApplicants, clone } = await import("./helpers/random.js");

const { decide, __calls: calls } = engine;

function widePolicy() {
  const cfg = clone(DEFAULT_CONFIG);
  cfg.eligibilityRules.find((r) => r.id === "amount-range").params = { minAmount: 0, maxAmount: 1_000_000 };
  return cfg;
}

// Reference answer by linear scan, counted separately.
function largestApproving(applicant, cfg, floor, request) {
  let best = null;
  for (let amt = floor; amt < request; amt += 1000) {
    if (decide({ ...applicant, loanAmount: String(amt) }, cfg).decision === "APPROVED") best = amt;
  }
  return best;
}

const applicant = {
  citizenship: "IN",
  destination: "US",
  degreeLevel: "masters",
  fieldOfStudy: "stem",
  schoolTier: "1",
  monthsToGraduation: "18",
  loanAmount: "1000000",
  householdIncome: "60000",
  creditHistory: "none",
  workExpYears: "1",
  admitConfirmed: true,
};

describe("amount search over a wide range", () => {
  beforeEach(() => {
    calls.n = 0;
  });

  it("floor 0 (effective 1000), ceiling 1,000,000, request 1,000,000: finds the largest approving amount", () => {
    const cfg = widePolicy();
    const result = decide(applicant, cfg);
    expect(result.stage).toBe("full-pipeline");
    expect(result.decision).not.toBe("APPROVED");

    calls.n = 0;
    const out = suggestChange(applicant, cfg, result);
    const used = calls.n;

    const expected = largestApproving(applicant, cfg, 1000, 1_000_000);
    expect(expected).not.toBeNull();
    expect(out).toMatchObject({ kind: "amount", amount: expected });
    expect(decide({ ...applicant, loanAmount: String(out.amount) }, cfg).decision).toBe("APPROVED");
    expect(decide({ ...applicant, loanAmount: String(out.amount + 1000) }, cfg).decision).not.toBe("APPROVED");

    // 999 candidates: one floor probe plus at most ceil(log2(999)) = 10 steps.
    expect(used).toBeLessThanOrEqual(12);
  });

  it("the effective floor is 1000 when the rule floor is 0", () => {
    const cfg = widePolicy();
    // Nothing approves: the gap names the floor it searched down to.
    const hopeless = { ...applicant, schoolTier: "3", fieldOfStudy: "other", householdIncome: "0", citizenship: "XX", workExpYears: "0" };
    const out = suggestChange(hopeless, cfg);
    expect(out.kind).toBe("gap");
    expect(out.floor).toBe(1000);
  });

  it("the floor follows an enabled amount-range rule and ignores a disabled one", () => {
    const high = widePolicy();
    high.eligibilityRules.find((r) => r.id === "amount-range").params.minAmount = 20000;
    const hopeless = { ...applicant, schoolTier: "3", fieldOfStudy: "other", householdIncome: "0", citizenship: "XX", workExpYears: "0" };
    expect(suggestChange(hopeless, high).floor).toBe(20000);
    high.eligibilityRules.find((r) => r.id === "amount-range").enabled = false;
    expect(suggestChange(hopeless, high).floor).toBe(1000);
  });

  it(`matches a linear scan and stays logarithmic for 200 random applicants on the wide policy`, () => {
    const cfg = widePolicy();
    let amounts = 0;
    for (const base of randomApplicants(99, 200)) {
      const a = { ...base, loanAmount: String(50_000 + (Number(base.loanAmount) * 6)) };
      const result = decide(a, cfg);
      if (result.stage !== "full-pipeline" || result.decision === "APPROVED" || result.unroutable) continue;
      calls.n = 0;
      const out = suggestChange(a, cfg, result);
      const used = calls.n;
      const request = Number(a.loanAmount);
      const candidates = Math.ceil(request / 1000) - 1;
      expect(used).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(Math.max(2, candidates))));
      const expected = largestApproving(a, cfg, 1000, request);
      if (expected === null) {
        expect(out.kind).toBe("gap");
      } else {
        amounts++;
        expect(out).toMatchObject({ kind: "amount", amount: expected });
      }
    }
    expect(amounts).toBeGreaterThan(10);
  });
});
