// Golden applicants: every hand-worked case in lib/scenarios.js must get the
// outcome it states under the default policy.
import { describe, it, expect } from "vitest";
import { decide } from "../lib/engine.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { SCENARIOS, PRESETS, scenarioById } from "../lib/scenarios.js";
import { applicantSchema } from "../lib/validate.js";

describe("golden scenarios under the default policy", () => {
  it("has 21 scenarios with unique ids", () => {
    expect(SCENARIOS).toHaveLength(21);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  describe.each(SCENARIOS.map((s) => [s.name, s]))("%s", (_name, s) => {
    const result = decide(s.applicant, DEFAULT_CONFIG);

    it("gets the expected decision and stage", () => {
      expect(result.decision).toBe(s.expect.decision);
      expect(result.stage).toBe(s.expect.stage);
    });

    if (s.expect.band) {
      it(`is priced in band ${s.expect.band}`, () => {
        expect(result.pricing?.band).toBe(s.expect.band);
      });
    }

    if (s.expect.score !== undefined) {
      it(`scores exactly ${s.expect.score}`, () => {
        expect(result.score).toBe(s.expect.score);
      });
    }

    if (s.expect.failedRules) {
      it("fails the expected rules, in order", () => {
        expect(result.reasons.map((r) => r.ruleId)).toEqual(s.expect.failedRules);
      });
    }

    if (s.expect.partner) {
      it(`routes to ${s.expect.partner}`, () => {
        expect(result.partner?.id).toBe(s.expect.partner);
      });
    }

    it("is a valid application under applicantSchema", () => {
      const parsed = applicantSchema.safeParse(s.applicant);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
  });

  it("PRESETS are exactly the five preset scenarios, in order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "strong-prime",
      "thin-file",
      "borderline-review",
      "low-score-decline",
      "ineligible-multi",
    ]);
    expect(PRESETS).toEqual(SCENARIOS.filter((s) => s.preset === true));
  });

  it("scenarioById finds a case and returns null for an unknown id", () => {
    expect(scenarioById("thin-file")?.name).toBe("Thin credit file");
    expect(scenarioById("nope")).toBeNull();
  });
});

describe("trace wording", () => {
  const detail = (res, step) => res.trace.filter((t) => t.step === step).map((t) => t.detail);

  it("intake names the destination country and the degree", () => {
    const res = decide(scenarioById("thin-file").applicant, DEFAULT_CONFIG);
    expect(detail(res, "intake")).toEqual([
      "Application received: the United States, Master's in STEM, amount $45,000",
    ]);
    const ca = decide(scenarioById("canada-routing").applicant, DEFAULT_CONFIG);
    expect(detail(ca, "intake")[0]).toMatch(/^Application received: Canada, /);
    const gb = decide(scenarioById("unsupported-destination").applicant, DEFAULT_CONFIG);
    expect(detail(gb, "intake")[0]).toMatch(/^Application received: the United Kingdom, /);
  });

  it("an eligibility decline pluralises the rule count", () => {
    const one = decide(scenarioById("no-admit").applicant, DEFAULT_CONFIG);
    expect(detail(one, "decision")).toEqual(["Declined: failed 1 eligibility rule"]);
    const three = decide(scenarioById("ineligible-multi").applicant, DEFAULT_CONFIG);
    expect(detail(three, "decision")).toEqual(["Declined: failed 3 eligibility rules"]);
  });

  it("the threshold line ends with a plain-language outcome", () => {
    const line = (id) => detail(decide(scenarioById(id).applicant, DEFAULT_CONFIG), "decision")[0];
    expect(line("thin-file")).toBe("Score 79.4 against approve at 65 and review at 50: Approved");
    expect(line("borderline-review")).toBe("Score 54.6 against approve at 65 and review at 50: Sent to review");
    expect(line("low-score-decline")).toBe("Score 49.1 against approve at 65 and review at 50: Declined");
    for (const s of SCENARIOS) {
      for (const d of detail(decide(s.applicant, DEFAULT_CONFIG), "decision")) {
        expect(d).not.toMatch(/APPROVED|REVIEW|DECLINED/);
      }
    }
  });

  it("every result carries unroutable as a boolean, false for the golden set", () => {
    for (const s of SCENARIOS) {
      expect(decide(s.applicant, DEFAULT_CONFIG).unroutable, s.id).toBe(false);
    }
  });
});
