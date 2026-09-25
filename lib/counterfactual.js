// "What would change this decision?"
//
// Deterministic and honest: every suggestion is checked by re-running the
// engine, and nothing is suggested that the engine has not confirmed.
// Only the loan amount is treated as a lever the applicant controls; school,
// credit history and income are reported as the gap, not as advice.
import { decide } from "./engine.js";

const STEP = 1000;

export function suggestChange(applicant, config, result = decide(applicant, config)) {
  if (!result || result.decision === "APPROVED") return null;

  if (result.stage === "eligibility") {
    return {
      kind: "eligibility",
      fixes: result.reasons.map((f) => ({
        ruleId: f.ruleId,
        rule: f.rule,
        hint: eligibilityHint(f.ruleId, applicant, config),
      })),
      note: "Clearing these rules moves the application on to scoring. It does not guarantee approval.",
    };
  }

  if (result.unroutable) {
    return {
      kind: "routing",
      hint: "The score clears the approval line, but no lending partner covers this destination, so a person has to place it.",
    };
  }

  const { approveAt } = config.decisionThresholds;
  const pointsNeeded = round1(approveAt - result.score);
  const amount = Number(applicant.loanAmount) || 0;
  const rangeRule = config.eligibilityRules.find((r) => r.id === "amount-range" && r.enabled);
  const floor = Math.max(STEP, rangeRule ? rangeRule.params.minAmount : STEP);

  // Search round thousands from the floor up to just below the request.
  // A smaller loan never lowers the score (a property the test suite checks),
  // so the approving amounts form a range starting at the floor and a binary
  // search finds its top in a handful of engine runs, however wide the range.
  const approves = (k) => decide({ ...applicant, loanAmount: String(k * STEP) }, config);
  let lo = Math.ceil(floor / STEP);
  let hi = Math.ceil(amount / STEP) - 1;
  if (hi >= lo) {
    const atFloor = approves(lo);
    if (atFloor.decision === "APPROVED") {
      let best = atFloor;
      let bestK = lo;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2); // upper middle, so lo always moves
        const r = approves(mid);
        if (r.decision === "APPROVED") {
          best = r;
          bestK = mid;
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return {
        kind: "amount",
        amount: bestK * STEP,
        score: best.score,
        band: best.pricing?.band ?? null,
        apr: best.pricing?.apr ?? null,
        pointsNeeded,
      };
    }
  }

  // No amount down to the floor gets there: name the biggest gap.
  const weakest = [...(result.breakdown || [])].sort(
    (a, b) => b.weight - b.points - (a.weight - a.points)
  )[0];
  return {
    kind: "gap",
    floor,
    pointsNeeded,
    factor: weakest ? weakest.factor : null,
    points: weakest ? round1(weakest.points) : null,
    weight: weakest ? weakest.weight : null,
  };
}

function eligibilityHint(ruleId, a, config) {
  const rule = config.eligibilityRules.find((r) => r.id === ruleId);
  const p = rule?.params || {};
  const amount = Number(a.loanAmount) || 0;
  switch (ruleId) {
    case "amount-range":
      return amount < p.minAmount
        ? `Request at least ${usd(p.minAmount)}.`
        : `Request ${usd(p.maxAmount)} or less.`;
    case "supported-destination":
      return (p.destinations || []).length
        ? `Choose an accepted destination: ${(p.destinations || []).map(countryName).join(", ")}.`
        : "No destinations are accepted under the current rules.";
    case "admit-confirmed":
      return "Confirm the admission offer.";
    case "enrollment-window":
      return Number(a.monthsToGraduation) <= 0
        ? "Apply for a program that has not yet finished."
        : `Graduation needs to be within ${p.maxMonthsToGraduation} months.`;
    case "graduate-only":
      return "Apply for a graduate program.";
    case "school-tier":
      return `Choose a school at tier ${p.maxTier} or better.`;
    default:
      return "Change the input this rule checks.";
  }
}

function countryName(c) {
  return { US: "United States", CA: "Canada", GB: "United Kingdom" }[c] || c;
}
function usd(n) {
  return `$${Number(n).toLocaleString("en-US")}`;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
