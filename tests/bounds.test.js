// Realistic input: every applicant field and every editable policy field is
// pushed through its boundaries, implausible values ("a $3 salary"), wrong
// data types and oversized strings. Each case is checked twice: against the
// schema (the exact message the form or rules console shows, or the number
// the value parses to) and through the API handler (400 at the right path
// with that message, never a 500, and never a 200 for a bad value).
import { describe, it, expect } from "vitest";
import { applicantSchema, configSchema, fieldErrors } from "../lib/validate.js";
import { DEFAULT_CONFIG } from "../lib/defaults.js";
import { SCENARIOS, PRESETS, scenarioById } from "../lib/scenarios.js";
import { randomApplicants, clone } from "./helpers/random.js";
import { callApi, firstIssue } from "./helpers/api.js";

const base = scenarioById("thin-file").applicant;
const MISSING = Symbol("missing");

// ---------------------------------------------------------------------------
// Authentic data stays valid
// ---------------------------------------------------------------------------

describe("authentic data stays valid", () => {
  it("the 5 presets and all 21 golden applicants pass the schema", () => {
    expect(PRESETS).toHaveLength(5);
    expect(SCENARIOS).toHaveLength(21);
    for (const s of SCENARIOS) {
      const r = applicantSchema.safeParse(s.applicant);
      expect(r.success, `${s.id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it("the golden applicants get a 200 from the API", async () => {
    for (const s of SCENARIOS) {
      const res = await callApi({ applicant: s.applicant });
      expect(res.statusCode, s.id).toBe(200);
      expect(res.body.decision, s.id).toBe(s.expect.decision);
    }
  });

  it("the default policy passes and is accepted by the API", async () => {
    expect(configSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
    const res = await callApi({ applicant: base, config: DEFAULT_CONFIG });
    expect(res.statusCode).toBe(200);
  });

  it("the random applicants used by the property tests are all valid", () => {
    for (const a of randomApplicants(20260925, 600)) {
      const r = applicantSchema.safeParse(a);
      expect(r.success, JSON.stringify(a)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Applicant fields
// ---------------------------------------------------------------------------

// Each case: [label, input, expected, knownBug?]. `expected` is either
// { value } (parses to that number) or { message } (exact first message).
function numericCases({ digits, required, range, huge = range }) {
  return [
    ["boolean true", true, { message: digits }],
    ["boolean false", false, { message: digits }],
    ["empty array", [], { message: digits }],
    ["array holding a number", [45000], { message: digits }],
    ["object", {}, { message: digits }],
    ["null", null, { message: required }],
    ["missing key", MISSING, { message: required }],
    ["empty string", "", { message: required }],
    ["blank string", "   ", { message: required }],
    ["NaN", NaN, { message: digits }],
    ["Infinity", Infinity, { message: digits }],
    ["-Infinity", -Infinity, { message: digits }],
    ['"Infinity"', "Infinity", { message: digits }],
    ['"1e5"', "1e5", { message: digits }],
    ['"0x10"', "0x10", { message: digits }],
    ['"45,000"', "45,000", { message: digits }],
    ['"$45000"', "$45000", { message: digits }],
    ['"+5"', "+5", { message: digits }],
    ["fullwidth digits", "４５０００", { message: digits }],
    ["Arabic-Indic digits", "٤٥٠٠٠", { message: digits }],
    ["zero-width space", "45000​", { message: digits }],
    ["emoji", "\u{1F4B0}", { message: digits }],
    ["words", "forty five thousand", { message: digits }],
    ["10,000 characters", "x".repeat(10000), { message: digits }],
    // Digits only, but too large for a double: Number() gives Infinity.
    // The user typed digits, so "using digits only" is the wrong message.
    ["400 nines", "9".repeat(400), { message: huge }, "digits-only message for an all-digit value"],
  ];
}

const APPLICANT_NUMERIC = {
  loanAmount: [
    ...numericCases({
      digits: "Enter a loan amount using digits only",
      required: "Enter a loan amount",
      range: "Enter a loan amount between $1,000 and $500,000",
    }),
    ["exact min $1,000", "1000", { value: 1000 }],
    ["min minus one step $999", "999", { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["exact max $500,000", "500000", { value: 500000 }],
    ["max plus one step $500,001", "500001", { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["$3", "3", { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["$3 as a JSON number", 3, { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["$0", "0", { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["negative", "-45000", { message: "Enter a loan amount between $1,000 and $500,000" }],
    ["cents", "45000.50", { message: "Use whole dollars for loan amount" }],
    ["trailing .00", "45000.00", { value: 45000 }],
    ["surrounding spaces", " 45000 ", { value: 45000 }],
    ["non-breaking spaces", " 45000 ", { value: 45000 }],
    ["leading zero", "045000", { value: 45000 }],
    ["JSON number", 45000, { value: 45000 }],
    ["JSON number written 1e5", 1e5, { value: 100000 }],
  ],
  householdIncome: [
    ...numericCases({
      digits: "Enter household income using digits only",
      required: "Enter household income",
      range: "Enter household income between $0 and $10,000,000 a year",
    }),
    ["$0 (no income)", "0", { value: 0 }],
    ["$1", "1", { message: "Enter 0 if there is no household income, or at least $1,000 a year" }],
    ["$3", "3", { message: "Enter 0 if there is no household income, or at least $1,000 a year" }],
    ["$3 as a JSON number", 3, { message: "Enter 0 if there is no household income, or at least $1,000 a year" }],
    ["$999", "999", { message: "Enter 0 if there is no household income, or at least $1,000 a year" }],
    ["$1,000", "1000", { value: 1000 }],
    ["exact max $10,000,000", "10000000", { value: 10000000 }],
    ["max plus one step", "10000001", { message: "Enter household income between $0 and $10,000,000 a year" }],
    ["negative $1", "-1", { message: "Enter household income between $0 and $10,000,000 a year" }],
    ["negative $5,000", "-5000", { message: "Enter household income between $0 and $10,000,000 a year" }],
    ["cents", "50000.5", { message: "Use whole dollars for household income" }],
  ],
  workExpYears: [
    ...numericCases({
      digits: "Enter work experience using digits only",
      required: "Enter work experience",
      range: "Enter work experience between 0 and 40 years",
    }),
    ["exact min 0", "0", { value: 0 }],
    ["min minus one step -0.1", "-0.1", { message: "Enter work experience between 0 and 40 years" }],
    ["exact max 40", "40", { value: 40 }],
    ["max plus one step 40.1", "40.1", { message: "Enter work experience between 0 and 40 years" }],
    ["40.5", "40.5", { message: "Enter work experience between 0 and 40 years" }],
    ["90 years", "90", { message: "Enter work experience between 0 and 40 years" }],
    ["2.25 (two decimals)", "2.25", { message: "Use at most one decimal place for work experience" }],
    ["2.5", "2.5", { value: 2.5 }],
    ["0.1", "0.1", { value: 0.1 }],
    ["2.50 (trailing zero)", "2.50", { value: 2.5 }],
  ],
  schoolTier: [
    ...numericCases({
      digits: "Enter a school tier using digits only",
      required: "Enter a school tier",
      range: "School tier must be between 1 and 4",
    }),
    ["exact min 1", "1", { value: 1 }],
    ["min minus one step 0", "0", { message: "School tier must be between 1 and 4" }],
    ["exact max 4", "4", { value: 4 }],
    ["max plus one step 5", "5", { message: "School tier must be between 1 and 4" }],
    ["1.5", "1.5", { message: "Use a whole number for school tier" }],
    ["negative", "-1", { message: "School tier must be between 1 and 4" }],
    ["JSON number 2", 2, { value: 2 }],
  ],
  monthsToGraduation: [
    ...numericCases({
      digits: "Enter expected graduation using digits only",
      required: "Enter expected graduation",
      range: "Expected graduation must be between -120 and 120",
    }),
    ["exact min -120", "-120", { value: -120 }],
    ["min minus one step -121", "-121", { message: "Expected graduation must be between -120 and 120" }],
    ["exact max 120", "120", { value: 120 }],
    ["max plus one step 121", "121", { message: "Expected graduation must be between -120 and 120" }],
    ["6.5", "6.5", { message: "Use a whole number for expected graduation" }],
    ["0 (valid input, declined by the rule)", "0", { value: 0 }],
  ],
};

function applicantWith(field, input) {
  const a = { ...base };
  if (input === MISSING) delete a[field];
  else a[field] = input;
  return a;
}

function checkSchema(field, input, expected) {
  const r = applicantSchema.safeParse(applicantWith(field, input));
  if ("value" in expected) {
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data[field]).toBe(expected.value);
  } else {
    expect(r.success).toBe(false);
    const errs = fieldErrors(r.error);
    expect(errs[field]).toBe(expected.message);
    // Only the field under test is reported.
    expect(Object.keys(errs)).toEqual([field]);
  }
}

async function checkApi(field, input, expected) {
  const res = await callApi({ applicant: applicantWith(field, input) });
  if ("value" in expected) {
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toMatch(/^(APPROVED|REVIEW|DECLINED)$/);
  } else {
    expect(res.statusCode).toBe(400);
    expect(firstIssue(res, `applicant.${field}`)).toBe(expected.message);
    for (const i of res.body.issues) expect(i.path).toBe(`applicant.${field}`);
  }
}

for (const [field, cases] of Object.entries(APPLICANT_NUMERIC)) {
  describe(`applicant.${field}`, () => {
    for (const [label, input, expected, knownBug] of cases) {
      const what = "value" in expected ? `parses to ${expected.value}` : `"${expected.message}"`;
      // Regression: an all-digit value too long to represent once overflowed
      // to Infinity and got "using digits only"; it must get the range message.
      it(`${label}: ${what}${knownBug ? " (regression)" : ""}`, () => checkSchema(field, input, expected));
      // The API check asserts status and path; the message part of the
      // known-bug case is covered by the schema test above.
      it(`${label}: API answers ${"value" in expected ? 200 : 400}`, async () => {
        if (knownBug) {
          const res = await callApi({ applicant: applicantWith(field, input) });
          expect(res.statusCode).toBe(400);
          expect(firstIssue(res, `applicant.${field}`)).toBeTruthy();
        } else {
          await checkApi(field, input, expected);
        }
      });
    }
  });
}

// Known bug in lib/validate.js decimalsOk: the absolute tolerance of 1e-9
// (meant to absorb float noise) lets a value with ten or more decimals pass
// "at most one decimal place", and the unrounded value reaches the engine.
// The same applies to APR ("at most two decimal places") and policy scores.
it("regression: work experience 2.50000000001 is refused as more than one decimal place", () => {
  checkSchema("workExpYears", "2.50000000001", { message: "Use at most one decimal place for work experience" });
});

// Non-numeric fields: country codes, enums and the admit checkbox.
const COUNTRY = "Use a two-letter country code";
const WRONG_TYPES = [
  ["number", 5],
  ["boolean", true],
  ["null", null],
  ["array", ["IN"]],
  ["object", { code: "IN" }],
  ["missing key", MISSING],
];

for (const field of ["citizenship", "destination"]) {
  describe(`applicant.${field}`, () => {
    it.each([
      ["lowercase", "in"],
      ["three letters", "IND"],
      ["one letter", "I"],
      ["empty", ""],
      ["leading space", " IN"],
      ["inner space", "I N"],
      ["digits", "12"],
      ["flag emoji", "\u{1F1EE}\u{1F1F3}"],
      ["accented letters", "ÉÉ"],
      ["10,000 characters", "X".repeat(10000)],
    ])("%s is refused with the country-code message", async (_l, input) => {
      checkSchema(field, input, { message: COUNTRY });
      await checkApi(field, input, { message: COUNTRY });
    });

    it.each(WRONG_TYPES)("%s is a 400 at the field path", async (_l, input) => {
      const r = applicantSchema.safeParse(applicantWith(field, input));
      expect(r.success).toBe(false);
      expect(Object.keys(fieldErrors(r.error))).toEqual([field]);
      const res = await callApi({ applicant: applicantWith(field, input) });
      expect(res.statusCode).toBe(400);
      expect(firstIssue(res, `applicant.${field}`)).toBeTruthy();
    });

    it("any well-formed two-letter code parses", () => {
      checkSchema(field, "CA", { value: "CA" });
    });
  });
}

const ENUMS = {
  degreeLevel: ["masters", "mba", "phd", "undergraduate"],
  fieldOfStudy: ["stem", "business", "medicine", "law", "other"],
  creditHistory: ["established", "thin", "none"],
};

for (const [field, values] of Object.entries(ENUMS)) {
  describe(`applicant.${field}`, () => {
    it.each(values)("%s parses", async (v) => {
      checkSchema(field, v, { value: v });
      const res = await callApi({ applicant: applicantWith(field, v) });
      expect(res.statusCode).toBe(200);
    });

    it.each([
      ["uppercase", values[0].toUpperCase()],
      ["trailing space", `${values[0]} `],
      ["empty", ""],
      ["emoji", "\u{1F393}"],
      ["10,000 characters", "x".repeat(10000)],
      ...WRONG_TYPES,
    ])("%s is a 400 at the field path", async (_l, input) => {
      const r = applicantSchema.safeParse(applicantWith(field, input));
      expect(r.success).toBe(false);
      expect(Object.keys(fieldErrors(r.error))).toEqual([field]);
      const res = await callApi({ applicant: applicantWith(field, input) });
      expect(res.statusCode).toBe(400);
      expect(firstIssue(res, `applicant.${field}`)).toBeTruthy();
    });
  });
}

describe("applicant.admitConfirmed", () => {
  it.each([true, false])("%s parses", (v) => checkSchema("admitConfirmed", v, { value: v }));

  it.each([
    ['"true"', "true"],
    ['"yes"', "yes"],
    ["1", 1],
    ["0", 0],
    ["empty string", ""],
    ...WRONG_TYPES.filter(([l]) => l !== "boolean"),
  ])("%s is a 400 at the field path", async (_l, input) => {
    const r = applicantSchema.safeParse(applicantWith("admitConfirmed", input));
    expect(r.success).toBe(false);
    const res = await callApi({ applicant: applicantWith("admitConfirmed", input) });
    expect(res.statusCode).toBe(400);
    expect(firstIssue(res, "applicant.admitConfirmed")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Editable policy fields (rules console, and any config sent to the API)
// ---------------------------------------------------------------------------

const idx = (id) => DEFAULT_CONFIG.eligibilityRules.findIndex((r) => r.id === id);
const AMOUNT = idx("amount-range");
const DEST = idx("supported-destination");
const WINDOW = idx("enrollment-window");
const TIER = idx("school-tier");
const band = (b) => DEFAULT_CONFIG.pricingTiers.findIndex((t) => t.band === b);

const amountParams = (patch) => (c) => Object.assign(c.eligibilityRules[AMOUNT].params, patch);
const P_MIN = `eligibilityRules.${AMOUNT}.params.minAmount`;
const P_MAX = `eligibilityRules.${AMOUNT}.params.maxAmount`;

// [label, mutate, path, expected] where expected is "ok", { message }, or
// "raw" (rejected at the path, message quality checked in the next block).
const POLICY_CASES = [
  // Loan amount floor and ceiling: whole dollars, $1,000 to $500,000.
  ["floor exact min $1,000", amountParams({ minAmount: 1000 }), P_MIN, "ok"],
  ["floor min minus one step $999", amountParams({ minAmount: 999 }), P_MIN, { message: "Use at least $1,000" }],
  ["floor $0", amountParams({ minAmount: 0 }), P_MIN, { message: "Use at least $1,000" }],
  ["floor $3", amountParams({ minAmount: 3 }), P_MIN, { message: "Use at least $1,000" }],
  ["floor with cents", amountParams({ minAmount: 5000.5 }), P_MIN, { message: "Use whole dollars" }],
  ["floor exact max $500,000", amountParams({ minAmount: 500000, maxAmount: 500000 }), P_MIN, "ok"],
  ["floor max plus one step", amountParams({ minAmount: 500001, maxAmount: 500000 }), P_MIN, { message: "Use at most $500,000" }],
  ["ceiling exact max $500,000", amountParams({ maxAmount: 500000 }), P_MAX, "ok"],
  ["ceiling max plus one step", amountParams({ maxAmount: 500001 }), P_MAX, { message: "Use at most $500,000" }],
  ["ceiling $1,000,000", amountParams({ maxAmount: 1000000 }), P_MAX, { message: "Use at most $500,000" }],
  ["ceiling $999", amountParams({ minAmount: 1000, maxAmount: 999 }), P_MAX, { message: "Use at least $1,000" }],
  ["ceiling below floor", amountParams({ minAmount: 5000, maxAmount: 4999 }), P_MIN, { message: "Floor must be at or below the ceiling" }],
  ["ceiling equal to floor", amountParams({ minAmount: 5000, maxAmount: 5000 }), P_MIN, "ok"],
  ["floor as a string", amountParams({ minAmount: "5000" }), P_MIN, "raw"],
  ["floor null", amountParams({ minAmount: null }), P_MIN, "raw"],

  // Enrollment window, 1 to 120 whole months.
  ...[1, 120].map((n) => [`window ${n}`, (c) => (c.eligibilityRules[WINDOW].params.maxMonthsToGraduation = n), `eligibilityRules.${WINDOW}.params.maxMonthsToGraduation`, "ok"]),
  ...[0, 121, 1.5, "48"].map((n) => [`window ${JSON.stringify(n)}`, (c) => (c.eligibilityRules[WINDOW].params.maxMonthsToGraduation = n), `eligibilityRules.${WINDOW}.params.maxMonthsToGraduation`, "raw"]),

  // Lowest school tier accepted, 1 to 4.
  ...[1, 4].map((n) => [`max tier ${n}`, (c) => (c.eligibilityRules[TIER].params.maxTier = n), `eligibilityRules.${TIER}.params.maxTier`, "ok"]),
  ...[0, 5, 2.5].map((n) => [`max tier ${n}`, (c) => (c.eligibilityRules[TIER].params.maxTier = n), `eligibilityRules.${TIER}.params.maxTier`, "raw"]),

  // Destinations.
  ["no destinations", (c) => (c.eligibilityRules[DEST].params.destinations = []), `eligibilityRules.${DEST}.params.destinations`, "ok"],
  ["US, CA and GB", (c) => (c.eligibilityRules[DEST].params.destinations = ["US", "CA", "GB"]), `eligibilityRules.${DEST}.params.destinations`, "ok"],
  ["lowercase destination", (c) => (c.eligibilityRules[DEST].params.destinations = ["us"]), `eligibilityRules.${DEST}.params.destinations.0`, { message: COUNTRY }],
  ["three-letter destination", (c) => (c.eligibilityRules[DEST].params.destinations = ["USA"]), `eligibilityRules.${DEST}.params.destinations.0`, { message: COUNTRY }],
  ["flag emoji destination", (c) => (c.eligibilityRules[DEST].params.destinations = ["\u{1F1FA}\u{1F1F8}"]), `eligibilityRules.${DEST}.params.destinations.0`, { message: COUNTRY }],
  ["51 destinations", (c) => (c.eligibilityRules[DEST].params.destinations = Array.from({ length: 51 }, (_, i) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)))), `eligibilityRules.${DEST}.params.destinations`, "raw"],

  // Rule switches.
  ["enabled as a string", (c) => (c.eligibilityRules[AMOUNT].enabled = "true"), `eligibilityRules.${AMOUNT}.enabled`, "raw"],

  // Decision thresholds, 0 to 100 with one decimal.
  ["approve at 0 (review at 0)", (c) => (c.decisionThresholds = { approveAt: 0, reviewAt: 0 }), "decisionThresholds.approveAt", "ok"],
  ["approve at 100", (c) => (c.decisionThresholds.approveAt = 100), "decisionThresholds.approveAt", "ok"],
  ["approve at 65.5", (c) => (c.decisionThresholds.approveAt = 65.5), "decisionThresholds.approveAt", "ok"],
  ["approve at 65.05", (c) => (c.decisionThresholds.approveAt = 65.05), "decisionThresholds.approveAt", { message: "Use at most one decimal place" }],
  ["approve at 100.1", (c) => (c.decisionThresholds.approveAt = 100.1), "decisionThresholds.approveAt", "raw"],
  ["approve at -0.1", (c) => (c.decisionThresholds = { approveAt: -0.1, reviewAt: -0.1 }), "decisionThresholds.approveAt", "raw"],
  ["approve at as a string", (c) => (c.decisionThresholds.approveAt = "65"), "decisionThresholds.approveAt", "raw"],
  ["approve at NaN", (c) => (c.decisionThresholds.approveAt = NaN), "decisionThresholds.approveAt", "raw"],
  ["review at equal to approve", (c) => (c.decisionThresholds.reviewAt = 65), "decisionThresholds.reviewAt", "ok"],
  ["review at above approve", (c) => (c.decisionThresholds.reviewAt = 65.1), "decisionThresholds.reviewAt", { message: "Review score must be at or below the approve score" }],
  ["review at 50.25", (c) => (c.decisionThresholds.reviewAt = 50.25), "decisionThresholds.reviewAt", { message: "Use at most one decimal place" }],

  // Pricing band floors, 0 to 100 with one decimal, unique.
  ["band A floor 80.5", (c) => (c.pricingTiers[band("A")].minScore = 80.5), `pricingTiers.${band("A")}.minScore`, "ok"],
  ["band A floor 100", (c) => (c.pricingTiers[band("A")].minScore = 100), `pricingTiers.${band("A")}.minScore`, "ok"],
  ["band A floor 80.55", (c) => (c.pricingTiers[band("A")].minScore = 80.55), `pricingTiers.${band("A")}.minScore`, { message: "Use at most one decimal place" }],
  ["band A floor 100.1", (c) => (c.pricingTiers[band("A")].minScore = 100.1), `pricingTiers.${band("A")}.minScore`, "raw"],
  ["band B floor equal to band A", (c) => (c.pricingTiers[band("B")].minScore = 80), `pricingTiers.${band("B")}.minScore`, { message: "Bands A and B can't share a minimum score" }],

  // APR, 0% to 36% with two decimals, never higher for a better band.
  ["band A APR 0%", (c) => (c.pricingTiers[band("A")].apr = 0), `pricingTiers.${band("A")}.apr`, "ok"],
  ["band C APR exact max 36%", (c) => (c.pricingTiers[band("C")].apr = 36), `pricingTiers.${band("C")}.apr`, "ok"],
  ["band C APR 36.01%", (c) => (c.pricingTiers[band("C")].apr = 36.01), `pricingTiers.${band("C")}.apr`, { message: "APR can't be above 36%" }],
  ["band C APR 99%", (c) => (c.pricingTiers[band("C")].apr = 99), `pricingTiers.${band("C")}.apr`, { message: "APR can't be above 36%" }],
  ["band A APR -0.01%", (c) => (c.pricingTiers[band("A")].apr = -0.01), `pricingTiers.${band("A")}.apr`, { message: "APR can't be negative" }],
  ["band A APR 9.499%", (c) => (c.pricingTiers[band("A")].apr = 9.499), `pricingTiers.${band("A")}.apr`, { message: "Use at most two decimal places for APR" }],
  ["band A APR 9.5%", (c) => (c.pricingTiers[band("A")].apr = 9.5), `pricingTiers.${band("A")}.apr`, "ok"],
  ["band A APR above band B", (c) => (c.pricingTiers[band("A")].apr = 12), `pricingTiers.${band("A")}.apr`, { message: "Band A needs a higher score than band B, so its APR can't be higher (12% vs 11.49%)" }],
  ["band A APR as a string", (c) => (c.pricingTiers[band("A")].apr = "9.49"), `pricingTiers.${band("A")}.apr`, "raw"],
  ["band A APR Infinity", (c) => (c.pricingTiers[band("A")].apr = Infinity), `pricingTiers.${band("A")}.apr`, "raw"],
  ["band label of 201 characters", (c) => (c.pricingTiers[band("A")].label = "x".repeat(201)), `pricingTiers.${band("A")}.label`, "raw"],
  ["empty band name", (c) => (c.pricingTiers[band("A")].band = ""), `pricingTiers.${band("A")}.band`, "raw"],

  // Scorecard weights, one decimal, adding up to 100.
  ["weights with one decimal", (c) => Object.assign(c.scorecard.weights, { schoolTier: 25.5, fieldOfStudy: 14.5 }), "scorecard.weights.schoolTier", "ok"],
  ["weights with two decimals", (c) => Object.assign(c.scorecard.weights, { schoolTier: 25.25, fieldOfStudy: 14.75 }), "scorecard.weights.schoolTier", { message: "Use at most one decimal place" }],
  ["weights adding to 105", (c) => (c.scorecard.weights.schoolTier = 30), "scorecard.weights", { message: "Scorecard weights must add up to 100" }],
  ["negative weight", (c) => Object.assign(c.scorecard.weights, { schoolTier: -5, fieldOfStudy: 45 }), "scorecard.weights.schoolTier", "raw"],

  // Free text.
  ["version of 21 characters", (c) => (c.version = "v".repeat(21)), "version", "raw"],
];

describe("policy fields", () => {
  it.each(POLICY_CASES.map((c) => [c[0], c]))("%s", async (_l, [, mutate, path, expected]) => {
    const cfg = clone(DEFAULT_CONFIG);
    mutate(cfg);
    const r = configSchema.safeParse(cfg);
    const res = await callApi({ applicant: base, config: cfg });
    if (expected === "ok") {
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      expect(res.statusCode).toBe(200);
      return;
    }
    expect(r.success).toBe(false);
    const errs = fieldErrors(r.error);
    expect(res.statusCode).toBe(400);
    expect(Object.keys(errs)).toContain(path);
    expect(firstIssue(res, `config.${path}`)).toBeTruthy();
    if (expected !== "raw") {
      expect(errs[path]).toBe(expected.message);
      expect(firstIssue(res, `config.${path}`)).toBe(expected.message);
    }
  });

  it("the API never answers 500 for any case above", async () => {
    for (const [label, mutate] of POLICY_CASES) {
      const cfg = clone(DEFAULT_CONFIG);
      mutate(cfg);
      const res = await callApi({ applicant: base, config: cfg });
      expect([200, 400], label).toContain(res.statusCode);
    }
  });
});

// ---------------------------------------------------------------------------
// Message quality: nothing a person reads may look broken or machine-made.
// ---------------------------------------------------------------------------

const DIRTY = [
  /[\u2013\u2014]/, // en and em dashes
  /undefined/,
  /NaN/,
  /\[object/,
  /Expected number/,
  /\bRequired\b/,
  /Expected (string|boolean|integer|array|object|date|bigint|'|")/, // other zod type defaults
  /received /,
  /Invalid enum value/,
  /String must contain/,
  /Number must be/,
  /Array must contain/,
  /Expected integer/,
  /Invalid input/,
];

function problems(messages, inputs = []) {
  const out = [];
  for (const m of messages) {
    for (const re of DIRTY) if (re.test(m)) out.push(`${JSON.stringify(m.slice(0, 120))} matches ${re}`);
    if (m.length > 200) out.push(`message is ${m.length} characters long`);
    for (const input of inputs) {
      if (typeof input === "string" && input.length >= 4 && m.includes(input)) out.push(`message echoes the input ${JSON.stringify(input.slice(0, 40))}`);
    }
  }
  return out;
}

function applicantMessages(field, inputs) {
  const msgs = [];
  for (const input of inputs) {
    const r = applicantSchema.safeParse(applicantWith(field, input));
    if (!r.success) msgs.push(...r.error.issues.map((i) => i.message));
  }
  return msgs;
}

const BAD_TEXT = ["", "in", "IND", "MASTERS", "masters ", "\u{1F393}", "x".repeat(10000), "true", "yes"];
const BAD_TYPES = [5, 0, 1, true, null, NaN, Infinity, ["IN"], { a: 1 }, MISSING];

describe("user-facing messages are clean", () => {
  it("the dirty-message detector itself works", () => {
    expect(problems(["Expected number, received string"])).not.toHaveLength(0);
    expect(problems(["Required"])).not.toHaveLength(0);
    expect(problems(["Enter a loan amount \u2014 please"])).not.toHaveLength(0);
    expect(problems(["Expected string, received number"])).not.toHaveLength(0);
    expect(problems(["Enter a loan amount"])).toHaveLength(0);
    expect(problems(["Expected graduation must be between -120 and 120"])).toHaveLength(0);
  });

  it.each(Object.keys(APPLICANT_NUMERIC))("every message for applicant.%s", (field) => {
    const inputs = APPLICANT_NUMERIC[field].map((c) => c[1]).concat(BAD_TEXT, BAD_TYPES);
    const msgs = applicantMessages(field, inputs);
    expect(msgs.length).toBeGreaterThan(20);
    expect(problems(msgs, inputs.filter((i) => typeof i === "string" && !/^\s*-?\d/.test(i)))).toEqual([]);
  });

  it("country-code format errors on applicant fields", () => {
    const inputs = ["in", "IND", "I", "", " IN", "\u{1F1EE}\u{1F1F3}", "X".repeat(10000)];
    expect(problems(applicantMessages("citizenship", inputs), inputs)).toEqual([]);
    expect(problems(applicantMessages("destination", inputs), inputs)).toEqual([]);
  });

  // Known bug in lib/validate.js: the country, enum and boolean fields use
  // zod's default messages for a wrong type or a missing key ("Expected
  // string, received number", "Required", "Expected boolean, received
  // string"), and the enums echo the submitted value back ("Invalid enum
  // value. Expected 'masters' | ..., received '<the input>'"), so a 10,000
  // character value comes back in the 400 body.
  it.each(["citizenship", "destination"])(
    "regression: wrong type or missing applicant.%s gets a written message",
    (field) => {
      expect(problems(applicantMessages(field, BAD_TYPES))).toEqual([]);
    }
  );

  it.each(Object.keys(ENUMS))("regression: applicant.%s enum messages are written, not zod defaults, and never echo the input", (field) => {
    const inputs = [...BAD_TEXT, ...BAD_TYPES];
    expect(problems(applicantMessages(field, inputs), inputs)).toEqual([]);
  });

  it("regression: applicant.admitConfirmed messages are written, not zod defaults", () => {
    const inputs = [...BAD_TEXT, ...BAD_TYPES.filter((v) => v !== true)];
    expect(problems(applicantMessages("admitConfirmed", inputs), inputs)).toEqual([]);
  });

  it("policy fields with written messages", () => {
    const msgs = [];
    for (const [, mutate, , expected] of POLICY_CASES) {
      if (typeof expected !== "object") continue;
      const cfg = clone(DEFAULT_CONFIG);
      mutate(cfg);
      msgs.push(...configSchema.safeParse(cfg).error.issues.map((i) => i.message));
    }
    expect(msgs.length).toBeGreaterThan(15);
    expect(problems(msgs)).toEqual([]);
  });

  // Known bug in lib/validate.js configSchema: range and type checks without a
  // written message (pct min/max, maxMonthsToGraduation, maxTier, .finite(),
  // string and array max lengths, booleans) surface zod defaults such as
  // "Number must be less than or equal to 100" or "Expected number, received
  // string" to API callers and, via commit(), to the rules console.
  it("regression: out-of-range and wrong-type policy values get written messages, not zod defaults", () => {
    const msgs = [];
    for (const [, mutate, , expected] of POLICY_CASES) {
      if (expected !== "raw") continue;
      const cfg = clone(DEFAULT_CONFIG);
      mutate(cfg);
      msgs.push(...configSchema.safeParse(cfg).error.issues.map((i) => i.message));
    }
    expect(problems(msgs)).toEqual([]);
  });
});
