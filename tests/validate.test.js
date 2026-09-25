// Input contracts shared by the form, the rules console and the API.
import { describe, it, expect } from "vitest";
import { applicantSchema, configSchema, decideRequestSchema, fieldErrors, issueList } from "../lib/validate.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { scenarioById } from "../lib/scenarios.js";
import { clone } from "./helpers/random.js";

const base = scenarioById("thin-file").applicant;

function errorFor(patch, field) {
  const parsed = applicantSchema.safeParse({ ...base, ...patch });
  expect(parsed.success).toBe(false);
  return fieldErrors(parsed.error)[field];
}

describe("applicant field errors", () => {
  it.each([
    ["empty string", "", "Enter a loan amount"],
    ["null", null, "Enter a loan amount"],
    ["whitespace", "   ", "Enter a loan amount"],
    ["tab and newline", "\t\n", "Enter a loan amount"],
    ["hex", "0x12", "Enter a loan amount using digits only"],
    ["exponent", "1e3", "Enter a loan amount using digits only"],
    ["leading dot", ".5", "Enter a loan amount using digits only"],
    ["trailing dot", "5.", "Enter a loan amount using digits only"],
    ["thousands separator", "45,000", "Enter a loan amount using digits only"],
    ["plus sign", "+500", "Enter a loan amount using digits only"],
    ["dollar sign", "$500", "Enter a loan amount using digits only"],
    ["not a number", "abc", "Enter a loan amount using digits only"],
    ["NaN", NaN, "Enter a loan amount using digits only"],
    ["Infinity", "Infinity", "Enter a loan amount using digits only"],
    ["negative", "-1", "Enter a loan amount between $1,000 and $500,000"],
    ["too large", "1000001", "Enter a loan amount between $1,000 and $500,000"],
    ["boolean", true, "Enter a loan amount using digits only"],
  ])("loan amount %s", (_n, value, message) => {
    expect(errorFor({ loanAmount: value }, "loanAmount")).toBe(message);
  });

  it("missing loan amount key", () => {
    const { loanAmount, ...rest } = base;
    const parsed = applicantSchema.safeParse(rest);
    expect(fieldErrors(parsed.error).loanAmount).toBe("Enter a loan amount");
  });

  it("whole-number fields reject fractions", () => {
    expect(errorFor({ schoolTier: "2.5" }, "schoolTier")).toBe("Use a whole number for school tier");
    expect(errorFor({ loanAmount: "45000.5" }, "loanAmount")).toBe("Use whole dollars for loan amount");
    expect(errorFor({ monthsToGraduation: "1.5" }, "monthsToGraduation")).toBe(
      "Use a whole number for expected graduation"
    );
  });

  it("school tier outside 1 to 4", () => {
    expect(errorFor({ schoolTier: "5" }, "schoolTier")).toBe("School tier must be between 1 and 4");
    expect(errorFor({ schoolTier: "0" }, "schoolTier")).toBe("School tier must be between 1 and 4");
  });

  it("other fields", () => {
    expect(errorFor({ householdIncome: "" }, "householdIncome")).toBe("Enter household income");
    expect(errorFor({ workExpYears: "61" }, "workExpYears")).toBe("Enter work experience between 0 and 40 years");
    expect(errorFor({ citizenship: "india" }, "citizenship")).toBe("Use a two-letter country code");
    expect(errorFor({ degreeLevel: "diploma" }, "degreeLevel")).toBeTruthy();
    expect(errorFor({ admitConfirmed: "yes" }, "admitConfirmed")).toBeTruthy();
  });

  it("trims and converts plain decimal strings", () => {
    const parsed = applicantSchema.parse({ ...base, loanAmount: " 45000 ", householdIncome: "\t1500.00\n", workExpYears: " 2.5 " });
    expect(parsed.loanAmount).toBe(45000);
    expect(parsed.householdIncome).toBe(1500);
    expect(parsed.workExpYears).toBe(2.5);
    expect(parsed.schoolTier).toBe(1);
    expect(applicantSchema.parse({ ...base, monthsToGraduation: "-3" }).monthsToGraduation).toBe(-3);
    expect(applicantSchema.parse({ ...base, householdIncome: "0" }).householdIncome).toBe(0);
  });

  it("blank means missing for every numeric field", () => {
    for (const k of ["schoolTier", "monthsToGraduation", "loanAmount", "householdIncome", "workExpYears"]) {
      expect(errorFor({ [k]: "  " }, k), k).toMatch(/^Enter /);
      expect(errorFor({ [k]: "  " }, k), k).not.toMatch(/digits only$/);
    }
  });

  it("numbers passed as numbers still work", () => {
    expect(applicantSchema.parse({ ...base, loanAmount: 1e3 }).loanAmount).toBe(1000);
  });

  it("rejects unknown keys", () => {
    const parsed = applicantSchema.safeParse({ ...base, extra: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].code).toBe("unrecognized_keys");
  });

  it("fieldErrors keeps the first message per path and uses _ for the root", () => {
    const parsed = decideRequestSchema.safeParse({ applicant: base, junk: 1 });
    expect(Object.keys(fieldErrors(parsed.error))).toEqual(["_"]);
  });

  it("issueList caps the list and flattens paths", () => {
    const parsed = applicantSchema.safeParse({});
    const list = issueList(parsed.error, 3);
    expect(list).toHaveLength(3);
    for (const i of list) expect(Object.keys(i).sort()).toEqual(["message", "path"]);
  });
});

describe("config schema", () => {
  it("DEFAULT_CONFIG passes", () => {
    const parsed = configSchema.safeParse(DEFAULT_CONFIG);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ["top level", (c) => (c.extra = true)],
    ["scorecard", (c) => (c.scorecard.bonus = 1)],
    ["weights", (c) => (c.scorecard.weights.luck = 0)],
    ["a rule", (c) => (c.eligibilityRules[0].owner = "me")],
    ["rule params", (c) => (c.eligibilityRules[0].params.currency = "USD")],
    ["thresholds", (c) => (c.decisionThresholds.denyAt = 10)],
    ["a pricing tier", (c) => (c.pricingTiers[0].fee = 1)],
    ["a partner", (c) => (c.partnerRouting[0].url = "x")],
  ])("a deep clone with an extra key in %s fails", (_n, mutate) => {
    const cfg = clone(DEFAULT_CONFIG);
    mutate(cfg);
    expect(configSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects a duplicated eligibility rule id", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.eligibilityRules.push(clone(cfg.eligibilityRules[1]));
    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error).eligibilityRules).toBe("Each rule can appear only once");
  });

  it("accepts the default tiers in any array order (the check sorts by minScore)", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.reverse();
    expect(configSchema.safeParse(cfg).success).toBe(true);
  });

  it("rejects a better band with a higher APR than a worse band", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.find((t) => t.band === "A").apr = 12;
    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
    const errs = fieldErrors(parsed.error);
    expect(errs["pricingTiers.0.apr"]).toBe("Band A needs a higher score than band B, so its APR can't be higher (12% vs 11.49%)");
  });

  it("rejects an APR inversion regardless of array order", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.reverse(); // C, B, A
    cfg.pricingTiers[0].apr = 10; // band C (worst) now cheaper than A
    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues.some((i) => /APR can't be higher/.test(i.message))).toBe(true);
  });

  it("allows equal APRs across bands (APR must not increase, equal is fine)", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.forEach((t) => (t.apr = 11));
    expect(configSchema.safeParse(cfg).success).toBe(true);
  });

  it("rejects two bands with the same minScore", () => {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.pricingTiers.find((t) => t.band === "B").minScore = 65;
    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues.map((i) => i.message)).toContain("Bands B and C can't share a minimum score");
  });

  it("rejects duplicate pricing bands and rules missing their params", () => {
    const dup = clone(DEFAULT_CONFIG);
    dup.pricingTiers[1].band = "A";
    expect(configSchema.safeParse(dup).success).toBe(false);

    const noTier = clone(DEFAULT_CONFIG);
    noTier.eligibilityRules.find((r) => r.id === "school-tier").params = {};
    expect(configSchema.safeParse(noTier).success).toBe(false);
  });
});
