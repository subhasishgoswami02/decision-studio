// Property tests for the engine. Each block covers one item of the INVARIANTS
// list published on the Policy tests page (pages/evals.js), in the same order.
// Every property runs on at least 500 seeded random applicants.
import { describe, it, expect } from "vitest";
import { decide } from "../lib/engine.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { SCENARIOS } from "../lib/scenarios.js";
import { suggestChange } from "../lib/counterfactual.js";
import { randomApplicants, RANK, clone } from "./helpers/random.js";

const N = 600;
const APPLICANTS = randomApplicants(20260925, N);

// Timing is the only thing allowed to differ between two runs.
function stripTiming(result) {
  const { totalMs, trace, ...rest } = result;
  return {
    ...rest,
    trace: trace
      .filter((t) => !(t.step === "complete" && t.detail.startsWith("Decision rendered in")))
      .map(({ elapsedMs, ...t }) => t),
  };
}

function withRule(config, id, patch) {
  const c = clone(config);
  const rule = c.eligibilityRules.find((r) => r.id === id);
  Object.assign(rule, patch);
  return c;
}

function allRulesOn(config) {
  const c = clone(config);
  c.eligibilityRules.forEach((r) => (r.enabled = true));
  return c;
}

describe("1. Determinism: same application, same decision, score and trace", () => {
  it(`holds for ${N} random applicants`, () => {
    for (const a of APPLICANTS) {
      const first = stripTiming(decide(a, DEFAULT_CONFIG));
      const second = stripTiming(decide({ ...a }, DEFAULT_CONFIG));
      expect(second).toEqual(first);
    }
  });

  it("does not mutate the applicant or the config", () => {
    const cfg = clone(DEFAULT_CONFIG);
    for (const a of APPLICANTS.slice(0, 100)) {
      const copy = clone(a);
      decide(a, cfg);
      expect(a).toEqual(copy);
    }
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});

describe("2. Scores stay in [0, 100] and equal the sum of their factors", () => {
  it(`holds for ${N} random applicants`, () => {
    let scored = 0;
    for (const a of APPLICANTS) {
      // All rules off so every applicant reaches the scorecard.
      for (const cfg of [DEFAULT_CONFIG, allRulesOffConfig()]) {
        const res = decide(a, cfg);
        if (res.score === null) continue;
        scored++;
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
        const sum = res.breakdown.reduce((s, b) => s + b.points, 0);
        expect(Math.abs(sum - res.score)).toBeLessThanOrEqual(0.1);
        for (const b of res.breakdown) {
          expect(b.points).toBeGreaterThanOrEqual(0);
          expect(b.points).toBeLessThanOrEqual(b.weight + 1e-9);
        }
      }
    }
    expect(scored).toBeGreaterThanOrEqual(N);
  });
});

function allRulesOffConfig() {
  const c = clone(DEFAULT_CONFIG);
  c.eligibilityRules.forEach((r) => (r.enabled = false));
  return c;
}

describe("3. Monotonicity: more income, better credit, a better school or a smaller loan never lowers the score", () => {
  const TIER_OFF = withRule(DEFAULT_CONFIG, "school-tier", { enabled: false });

  // Compare two variants of one applicant; both must be scored to count.
  function assertNoWorse(lower, higher, cfg, label) {
    const lo = decide(lower, cfg);
    const hi = decide(higher, cfg);
    if (lo.score === null || hi.score === null) return false;
    expect(hi.score, `${label}: score`).toBeGreaterThanOrEqual(lo.score);
    expect(RANK[hi.decision], `${label}: decision`).toBeGreaterThanOrEqual(RANK[lo.decision]);
    return true;
  }

  it("raising household income", () => {
    let compared = 0;
    for (const a of APPLICANTS) {
      const raised = { ...a, householdIncome: String(Number(a.householdIncome) + 1 + (Number(a.loanAmount) % 50000)) };
      if (assertNoWorse(a, raised, DEFAULT_CONFIG, "income")) compared++;
      if (assertNoWorse(a, raised, allRulesOffConfig(), "income, rules off")) compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(500);
  });

  it("improving credit history (none, thin, established)", () => {
    const ladder = ["none", "thin", "established"];
    let compared = 0;
    for (const a of APPLICANTS) {
      for (let i = 0; i < ladder.length - 1; i++) {
        const lower = { ...a, creditHistory: ladder[i] };
        const higher = { ...a, creditHistory: ladder[i + 1] };
        if (assertNoWorse(lower, higher, allRulesOffConfig(), "credit")) compared++;
        assertNoWorse(lower, higher, DEFAULT_CONFIG, "credit, default rules");
      }
    }
    expect(compared).toBeGreaterThanOrEqual(500);
  });

  it("improving school tier (4, 3, 2, 1) with the school-tier rule off", () => {
    let compared = 0;
    for (const a of APPLICANTS) {
      for (let tier = 4; tier > 1; tier--) {
        const lower = { ...a, schoolTier: String(tier) };
        const higher = { ...a, schoolTier: String(tier - 1) };
        if (assertNoWorse(lower, higher, TIER_OFF, "school tier")) compared++;
        if (assertNoWorse(lower, higher, allRulesOffConfig(), "school tier, rules off")) compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(500);
  });

  it("lowering the loan amount", () => {
    let compared = 0;
    for (const a of APPLICANTS) {
      const amount = Number(a.loanAmount);
      for (const cut of [1, 1000, Math.floor(amount / 2)]) {
        const smaller = { ...a, loanAmount: String(Math.max(1, amount - cut)) };
        if (assertNoWorse(a, smaller, DEFAULT_CONFIG, "amount")) compared++;
        if (assertNoWorse(a, smaller, allRulesOffConfig(), "amount, rules off")) compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(500);
  });
});

describe("4. Switching an eligibility rule off never makes an outcome worse", () => {
  const bases = { default: DEFAULT_CONFIG, "all rules on": allRulesOn(DEFAULT_CONFIG) };

  for (const [baseName, base] of Object.entries(bases)) {
    for (const rule of base.eligibilityRules.filter((r) => r.enabled)) {
      it(`${baseName}: turning off ${rule.id}`, () => {
        const off = withRule(base, rule.id, { enabled: false });
        for (const a of APPLICANTS) {
          const before = decide(a, base);
          const after = decide(a, off);
          expect(RANK[after.decision], JSON.stringify(a)).toBeGreaterThanOrEqual(RANK[before.decision]);
        }
      });
    }
  }
});

describe("5. An approval carries a price and a partner; a knockout names the failed rule", () => {
  it(`holds for ${N} random applicants under default, all-rules-on and accept-GB policies`, () => {
    let approved = 0;
    let knockedOut = 0;
    let unroutable = 0;
    // GB accepted by the destination rule but with no GB partner exercises the
    // "approved on score but unroutable" path.
    const acceptGB = withRule(DEFAULT_CONFIG, "supported-destination", { params: { destinations: ["US", "CA", "GB"] } });
    for (const cfg of [DEFAULT_CONFIG, allRulesOn(DEFAULT_CONFIG), acceptGB]) {
      for (const a of APPLICANTS) {
        const res = decide(a, cfg);
        if (res.decision === "APPROVED") {
          approved++;
          expect(res.pricing).toBeTruthy();
          expect(typeof res.pricing.band).toBe("string");
          expect(res.pricing.band.length).toBeGreaterThan(0);
          expect(typeof res.pricing.apr).toBe("number");
          expect(res.partner).toBeTruthy();
          expect(res.partner.id).toBeTruthy();
          expect(res.partner.name).toBeTruthy();
          expect(res.unroutable).toBe(false);
        }
        // unroutable is true only for an approval on score with no partner.
        expect(typeof res.unroutable).toBe("boolean");
        if (res.unroutable) {
          unroutable++;
          expect(res.decision).toBe("REVIEW");
          expect(res.partner).toBeNull();
          expect(res.pricing).toBeTruthy();
          expect(res.score).toBeGreaterThanOrEqual(cfg.decisionThresholds.approveAt);
        }
        if (res.decision === "DECLINED" && res.stage === "eligibility") {
          knockedOut++;
          expect(res.reasons.length).toBeGreaterThanOrEqual(1);
          const ids = cfg.eligibilityRules.map((r) => r.id);
          for (const r of res.reasons) {
            expect(ids).toContain(r.ruleId);
            expect(typeof r.rule).toBe("string");
            expect(r.rule.length).toBeGreaterThan(0);
            expect(typeof r.reason).toBe("string");
            expect(r.reason.length).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(approved).toBeGreaterThan(20);
    expect(knockedOut).toBeGreaterThan(20);
    expect(unroutable).toBeGreaterThan(0);
  });
});

describe("6. A higher score never gets a higher rate", () => {
  it(`holds across approvals from ${N} random applicants`, () => {
    const cfg = withRule(DEFAULT_CONFIG, "school-tier", { enabled: false });
    const approved = [];
    for (const c of [DEFAULT_CONFIG, cfg, allRulesOffConfig()]) {
      for (const a of APPLICANTS) {
        const res = decide(a, c);
        if (res.decision === "APPROVED") approved.push(res);
      }
    }
    expect(approved.length).toBeGreaterThan(50);
    approved.sort((x, y) => x.score - y.score);
    for (let i = 1; i < approved.length; i++) {
      expect(approved[i].pricing.apr).toBeLessThanOrEqual(approved[i - 1].pricing.apr);
    }
  });

  it("also holds when the approve line sits below every band floor", () => {
    const low = clone(DEFAULT_CONFIG);
    low.decisionThresholds = { approveAt: 30, reviewAt: 20 };
    const approved = APPLICANTS.map((a) => decide(a, low)).filter((r) => r.decision === "APPROVED");
    approved.sort((x, y) => x.score - y.score);
    for (let i = 1; i < approved.length; i++) {
      expect(approved[i].pricing.apr).toBeLessThanOrEqual(approved[i - 1].pricing.apr);
    }
  });
});

describe("7. Every rule that is on appears exactly once in the trace", () => {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function checkTrace(res, cfg) {
    const elig = res.trace.filter((t) => t.step === "eligibility").map((t) => t.detail);
    for (const rule of cfg.eligibilityRules) {
      const ran = new RegExp(`^(PASS|FAIL): ${escape(rule.name)}( \\(|$)`);
      const skipped = `Rule skipped (disabled): ${rule.name}`;
      const ranCount = elig.filter((d) => ran.test(d)).length;
      const skipCount = elig.filter((d) => d === skipped).length;
      if (rule.enabled) {
        expect(ranCount, `${rule.id} should run once`).toBe(1);
        expect(skipCount).toBe(0);
      } else {
        expect(ranCount, `${rule.id} should not run`).toBe(0);
        expect(skipCount, `${rule.id} should be skipped once`).toBe(1);
      }
    }
    expect(elig).toHaveLength(cfg.eligibilityRules.length);
  }

  it(`holds for ${N} random applicants under several rule sets`, () => {
    const configs = [DEFAULT_CONFIG, allRulesOn(DEFAULT_CONFIG), allRulesOffConfig()];
    // Plus every single-rule-off variant of the all-on policy.
    for (const r of DEFAULT_CONFIG.eligibilityRules) {
      configs.push(withRule(allRulesOn(DEFAULT_CONFIG), r.id, { enabled: false }));
    }
    for (const cfg of configs) {
      for (const a of APPLICANTS) checkTrace(decide(a, cfg), cfg);
    }
  });
});

// 8. "The API rejects malformed applications and rule sets with a 400, never a
// crash" is covered in tests/api.test.js (400 cases plus a 300-body fuzz).

describe("approve threshold boundary is inclusive, on the reported score", () => {
  const scored = SCENARIOS.filter((s) => s.expect.stage === "full-pipeline" && s.expect.score !== undefined);

  it.each(scored.map((s) => [s.name, s]))("%s: approveAt equal to its score approves, +0.1 does not", (_n, s) => {
    const at = clone(DEFAULT_CONFIG);
    at.decisionThresholds = { approveAt: s.expect.score, reviewAt: Math.min(50, s.expect.score) };
    const approved = decide(s.applicant, at);
    expect(approved.score).toBe(s.expect.score);
    expect(approved.decision).toBe("APPROVED");

    const above = clone(DEFAULT_CONFIG);
    const line = Math.round((s.expect.score + 0.1) * 10) / 10;
    above.decisionThresholds = { approveAt: line, reviewAt: Math.min(50, s.expect.score) };
    expect(decide(s.applicant, above).decision).not.toBe("APPROVED");
  });

  it(`for ${N} random applicants, the reported score alone decides the threshold outcome`, () => {
    const { approveAt, reviewAt } = DEFAULT_CONFIG.decisionThresholds;
    for (const a of APPLICANTS) {
      const res = decide(a, allRulesOffConfig());
      expect(Math.round(res.score * 10) / 10).toBe(res.score);
      const onScore = res.score >= approveAt ? "APPROVED" : res.score >= reviewAt ? "REVIEW" : "DECLINED";
      expect(res.unroutable ? "APPROVED" : res.decision).toBe(onScore);
    }
  });

  // Regression: raw score 64.96 used to be reported as 65 but sent to review
  // under the default policy, with a false "no partner" suggestion.
  it("regression: a US applicant with a reported 65 is approved under the default policy", () => {
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
    const res = decide(a, DEFAULT_CONFIG);
    expect(res.score).toBe(65);
    expect(res.decision).toBe("APPROVED");
    expect(res.pricing.band).toBe("C");
    expect(res.unroutable).toBe(false);
    expect(suggestChange(a, DEFAULT_CONFIG, res)).toBeNull();
  });
});
