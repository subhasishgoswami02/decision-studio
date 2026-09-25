// Input contracts for the decision service.
// The same schemas run in the browser (form and rules console) and on the
// server (API route), so a request the UI would reject is rejected by the API
// too, and a hand-crafted request cannot push the engine outside its range.
import { z } from "zod";

// Plain-language fallback messages for every check that has no message of its
// own, so neither the form, the rules console nor an API caller ever sees a
// raw library message, and no message echoes the submitted value back.
function friendlyErrors(issue, ctx) {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined") return { message: "This field is required" };
      if (issue.expected === "number") return { message: "Enter a number" };
      if (issue.expected === "integer") return { message: "Use a whole number" };
      if (issue.expected === "boolean") return { message: "Choose yes or no" };
      if (issue.expected === "string") return { message: "Enter text" };
      if (issue.expected === "array") return { message: "Provide a list" };
      return { message: "This value has the wrong type" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Choose one of the listed options" };
    case z.ZodIssueCode.too_small:
      if (issue.type === "number") return { message: `Use a value of at least ${fmt(issue.minimum)}` };
      if (issue.type === "string") return { message: "This can't be empty" };
      return { message: `Provide at least ${issue.minimum} item${issue.minimum === 1 ? "" : "s"}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === "number") return { message: `Use a value of at most ${fmt(issue.maximum)}` };
      if (issue.type === "string") return { message: `Keep this to ${issue.maximum} characters or fewer` };
      return { message: `Use at most ${issue.maximum} items` };
    case z.ZodIssueCode.not_finite:
      return { message: "Enter a finite number" };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: "Remove fields this service doesn't accept" };
    case z.ZodIssueCode.invalid_string:
      return { message: "This text isn't in the expected format" };
    default:
      return { message: ctx.defaultError && !/received|Expected|Invalid/.test(ctx.defaultError) ? ctx.defaultError : "This value isn't valid" };
  }
}
z.setErrorMap(friendlyErrors);

const country = z
  .string({ required_error: "Choose a country", invalid_type_error: "Use a two-letter country code" })
  .max(2, "Use a two-letter country code")
  .regex(/^[A-Z]{2}$/, "Use a two-letter country code");
const choice = (values, what) =>
  z.enum(values, { errorMap: () => ({ message: `Choose ${what} from the list` }) });

// Form fields arrive as strings. Treat an empty or blank field as missing,
// not as 0, and accept plain decimal numbers only (no hex, no exponents,
// no thousands separators). Bounds are set to what a real application could
// contain, so nonsense like a $3 loan or 90 years of experience is refused
// with a message instead of being scored.
const NUMERIC = /^-?\d+(\.\d+)?$/;
// True when n has at most `places` decimals, exactly (2.50000000001 fails).
const decimalsOk = (n, places) => Number.isFinite(n) && Number(n.toFixed(places)) === n;

const numberField = (label, { min, max, int = false, decimals, range, money = false }) => {
  const show = (n) => (money ? `$${fmt(n)}` : fmt(n));
  const rangeMsg = range || `${cap(label)} must be between ${show(min)} and ${show(max)}`;
  return z.preprocess(
    (v) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v === "string") {
        const t = v.trim();
        if (t === "") return undefined;
        if (!NUMERIC.test(t)) return NaN;
        const n = Number(t);
        // All digits but too long to represent: report it as out of range.
        return Number.isFinite(n) ? n : (t.startsWith("-") ? -Number.MAX_VALUE : Number.MAX_VALUE);
      }
      return v;
    },
    z
      .number({
        required_error: `Enter ${article(label)}`,
        invalid_type_error: `Enter ${article(label)} using digits only`,
      })
      .refine(Number.isFinite, `Enter ${article(label)} using digits only`)
      .refine((n) => !int || Number.isInteger(n), money ? `Use whole dollars for ${label}` : `Use a whole number for ${label}`)
      .refine((n) => decimals === undefined || decimalsOk(n, decimals), `Use at most ${decimals === 1 ? "one decimal place" : `${decimals} decimal places`} for ${label}`)
      .refine((n) => n >= min && n <= max, rangeMsg)
  );
};

function article(label) {
  return label === "household income" || label === "work experience" || label === "expected graduation" ? label : `a ${label}`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

export const DEGREE_LEVELS = ["masters", "mba", "phd", "undergraduate"];
export const FIELDS_OF_STUDY = ["stem", "business", "medicine", "law", "other"];
export const CREDIT_HISTORIES = ["established", "thin", "none"];

export const applicantSchema = z
  .object({
    citizenship: country,
    destination: country,
    degreeLevel: choice(DEGREE_LEVELS, "a degree level"),
    fieldOfStudy: choice(FIELDS_OF_STUDY, "a field of study"),
    schoolTier: numberField("school tier", { min: 1, max: 4, int: true }),
    monthsToGraduation: numberField("expected graduation", { min: -120, max: 120, int: true }),
    // A student loan request below $1,000 or above $500,000 is not a real
    // request. Amounts inside that band but outside the program limits are
    // valid input and get declined by the amount rule, with a reason.
    loanAmount: numberField("loan amount", {
      min: 1_000,
      max: 500_000,
      int: true,
      money: true,
      range: "Enter a loan amount between $1,000 and $500,000",
    }),
    // 0 means no household income. Anything from $1 to $999 a year is almost
    // certainly a typo (monthly figure, missing zeros), so it is refused.
    householdIncome: numberField("household income", {
      min: 0,
      max: 10_000_000,
      int: true,
      money: true,
      range: "Enter household income between $0 and $10,000,000 a year",
    }).refine((n) => n === 0 || n >= 1_000, "Enter 0 if there is no household income, or at least $1,000 a year"),
    creditHistory: choice(CREDIT_HISTORIES, "a credit history"),
    workExpYears: numberField("work experience", {
      min: 0,
      max: 40,
      decimals: 1,
      range: "Enter work experience between 0 and 40 years",
    }),
    admitConfirmed: z.boolean({
      required_error: "Say whether admission is confirmed",
      invalid_type_error: "Say whether admission is confirmed",
    }),
  })
  .strict();

const RULE_IDS = [
  "amount-range",
  "supported-destination",
  "admit-confirmed",
  "enrollment-window",
  "graduate-only",
  "school-tier",
];

const text = z.string().max(200);
// Scores carry one decimal, so thresholds and band floors do too.
const pct = z.number().finite().min(0).max(100).refine((n) => decimalsOk(n, 1), "Use at most one decimal place");
const policyAmount = z.number().int("Use whole dollars").min(1_000, "Use at least $1,000").max(500_000, "Use at most $500,000");

const ruleSchema = z
  .object({
    id: z.enum(RULE_IDS),
    name: text,
    description: z.string().max(400),
    enabled: z.boolean(),
    params: z
      .object({
        minAmount: policyAmount.optional(),
        maxAmount: policyAmount.optional(),
        destinations: z.array(country).max(50).optional(),
        maxMonthsToGraduation: z.number().int().min(1).max(120).optional(),
        maxTier: z.number().int().min(1).max(4).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const p = r.params;
    if (r.id === "amount-range") {
      if (p.minAmount === undefined || p.maxAmount === undefined)
        ctx.addIssue({ code: "custom", message: "Amount rule needs a floor and a ceiling" });
      else if (p.minAmount > p.maxAmount)
        ctx.addIssue({ code: "custom", path: ["params", "minAmount"], message: "Floor must be at or below the ceiling" });
    }
    if (r.id === "supported-destination" && !p.destinations)
      ctx.addIssue({ code: "custom", message: "Destination rule needs a destination list" });
    if (r.id === "enrollment-window" && p.maxMonthsToGraduation === undefined)
      ctx.addIssue({ code: "custom", message: "Enrollment rule needs a window" });
    if (r.id === "school-tier" && p.maxTier === undefined)
      ctx.addIssue({ code: "custom", message: "School tier rule needs a tier" });
  });

const unitScore = z.number().finite().min(0).max(1);

export const configSchema = z
  .object({
    version: z.string().max(20),
    eligibilityRules: z
      .array(ruleSchema)
      .min(1)
      .max(20)
      .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, "Each rule can appear only once"),
    scorecard: z
      .object({
        weights: z
          .object({
            schoolTier: pct,
            fieldOfStudy: pct,
            creditHistory: pct,
            incomeCoverage: pct,
            workExperience: pct,
            countryRisk: pct,
          })
          .strict()
          .refine(
            (w) => Math.abs(Object.values(w).reduce((s, n) => s + n, 0) - 100) < 0.001,
            "Scorecard weights must add up to 100"
          ),
        fieldScores: z.record(z.enum(FIELDS_OF_STUDY), unitScore),
        degreeMultipliers: z.record(z.enum(DEGREE_LEVELS), z.number().finite().min(0).max(1)),
        countryRisk: z
          .object({ low: z.array(country).max(250), medium: z.array(country).max(250) })
          .strict(),
      })
      .strict(),
    decisionThresholds: z
      .object({ approveAt: pct, reviewAt: pct })
      .strict()
      .refine((t) => t.reviewAt <= t.approveAt, {
        message: "Review score must be at or below the approve score",
        path: ["reviewAt"],
      }),
    pricingTiers: z
      .array(
        z
          .object({
            band: z.string().min(1).max(3),
            minScore: pct,
            apr: z
              .number()
              .finite()
              .min(0, "APR can't be negative")
              .max(36, "APR can't be above 36%")
              .refine((n) => decimalsOk(n, 2), "Use at most two decimal places for APR"),
            label: text,
          })
          .strict()
      )
      .min(1)
      .max(8)
      .refine((tiers) => new Set(tiers.map((t) => t.band)).size === tiers.length, "Pricing bands must be unique")
      .superRefine((tiers, ctx) => {
        // A better score must never cost more: sorted by floor, APR can only rise.
        const byFloor = tiers.map((t, i) => ({ ...t, i })).sort((a, b) => b.minScore - a.minScore);
        for (let k = 1; k < byFloor.length; k++) {
          const better = byFloor[k - 1];
          const worse = byFloor[k];
          if (better.minScore === worse.minScore) {
            ctx.addIssue({ code: "custom", path: [worse.i, "minScore"], message: `Bands ${better.band} and ${worse.band} can't share a minimum score` });
          } else if (better.apr > worse.apr) {
            ctx.addIssue({
              code: "custom",
              path: [better.i, "apr"],
              message: `Band ${better.band} needs a higher score than band ${worse.band}, so its APR can't be higher (${better.apr}% vs ${worse.apr}%)`,
            });
          }
        }
      }),
    partnerRouting: z
      .array(
        z
          .object({ id: text, name: text, destinations: z.array(country).max(50) })
          .strict()
      )
      .max(20),
  })
  .strict();

export const decideRequestSchema = z
  .object({
    applicant: applicantSchema,
    config: configSchema.optional(),
  })
  .strict();

// Flatten zod issues into { "path.to.field": "message" }, first message wins.
export function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// Short, safe list for API responses.
export function issueList(error, limit = 10) {
  return error.issues.slice(0, limit).map((i) => ({ path: i.path.join("."), message: i.message }));
}
