// Policy tests (blast radius of a rule edit), as shown on the evals page.
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { runPolicyTests, label, outcomeOf } from "../lib/impact.js";
import { decide } from "../lib/engine.js";
import { scenarioById } from "../lib/scenarios.js";
import { clone } from "./helpers/random.js";

const changedIds = (report) => report.rows.filter((r) => !r.match).map((r) => r.scenario.id);
const row = (report, id) => report.rows.find((r) => r.scenario.id === id);

describe("runPolicyTests", () => {
  it("the default policy matches all 21 cases", () => {
    const report = runPolicyTests(DEFAULT_CONFIG);
    expect(report.total).toBe(21);
    expect(report.matched).toBe(21);
    expect(report.changed).toBe(0);
    expect(report.approvalsActual).toBe(report.approvalsExpected);
    expect(report.rows.every((r) => r.direction === "same")).toBe(true);
  });

  it("raising approveAt to 75 changes exactly the entry-band and PhD cases, both for the worse", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.decisionThresholds.approveAt = 75;
    const report = runPolicyTests(cfg);
    expect(changedIds(report).sort()).toEqual(["entry-band", "phd-no-income"]);
    for (const id of ["entry-band", "phd-no-income"]) {
      expect(row(report, id).direction).toBe("worse");
      expect(row(report, id).actual.decision).toBe("REVIEW");
    }
    expect(report.approvalsActual).toBe(report.approvalsExpected - 2);
  });

  it("turning on graduate-only makes only the undergraduate case worse", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.eligibilityRules.find((r) => r.id === "graduate-only").enabled = true;
    const report = runPolicyTests(cfg);
    expect(changedIds(report)).toEqual(["undergrad-rule-off"]);
    const r = row(report, "undergrad-rule-off");
    expect(r.direction).toBe("worse");
    expect(r.actual).toMatchObject({ decision: "DECLINED", stage: "eligibility" });
  });

  it("accepting the UK turns the UK case into REVIEW (approved on score, no partner), a better outcome", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.eligibilityRules.find((r) => r.id === "supported-destination").params.destinations.push("GB");
    const report = runPolicyTests(cfg);
    const r = row(report, "unsupported-destination");
    expect(r.match).toBe(false);
    expect(r.direction).toBe("better");
    // Priced on score (band A) but unroutable, so the engine sends it to REVIEW.
    expect(r.actual).toMatchObject({ decision: "REVIEW", stage: "full-pipeline", band: "A", score: 100 });
    const full = decide(scenarioById("unsupported-destination").applicant, cfg);
    expect(full.partner).toBeNull();
    expect(full.unroutable).toBe(true);
    expect(full.pricing).not.toBeNull();
    // The multi-rule case still fails its other two rules.
    expect(row(report, "ineligible-multi").match).toBe(true);
    expect(changedIds(report)).toEqual(["unsupported-destination"]);
  });

  it("reports a band change on an approval as better or worse", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.find((t) => t.band === "A").minScore = 101;
    const report = runPolicyTests(cfg);
    const r = row(report, "strong-prime");
    expect(r.actual.band).toBe("B");
    expect(r.direction).toBe("worse");
  });
});

describe("label and outcomeOf", () => {
  it("labels every outcome", () => {
    expect(label(null)).toBe("");
    expect(label(undefined)).toBe("");
    expect(label({ decision: "APPROVED", band: "A" })).toBe("Approved, band A");
    expect(label({ decision: "APPROVED", band: null })).toBe("Approved");
    expect(label({ decision: "REVIEW" })).toBe("Sent to review");
    expect(label({ decision: "DECLINED", stage: "eligibility" })).toBe("Declined, ineligible");
    expect(label({ decision: "DECLINED", stage: "full-pipeline" })).toBe("Declined");
  });

  it("outcomeOf keeps decision, band, score and stage", () => {
    const o = outcomeOf(decide(scenarioById("thin-file").applicant, DEFAULT_CONFIG));
    expect(o).toEqual({ decision: "APPROVED", band: "B", score: 79.4, stage: "full-pipeline" });
    const d = outcomeOf(decide(scenarioById("no-admit").applicant, DEFAULT_CONFIG));
    expect(d).toEqual({ decision: "DECLINED", band: null, score: null, stage: "eligibility" });
  });
});
