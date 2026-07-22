// Pure decisioning engine. No I/O, fully deterministic, fully traceable.
// The trace is the point: every decision explains itself.

export function decide(applicant, config) {
  const t0 = Date.now();
  const trace = [];
  const log = (step, detail) =>
    trace.push({ step, detail, elapsedMs: Date.now() - t0 });

  const amountNum = Number(applicant.loanAmount) || 0;
  log("intake", `Application received: ${applicant.destination} destination, ${labelDegree(applicant.degreeLevel)} in ${labelField(applicant.fieldOfStudy)}, amount $${amountNum.toLocaleString()}`);

  // ---- Stage 1: eligibility knockouts ----
  const failures = [];
  for (const rule of config.eligibilityRules) {
    if (!rule.enabled) {
      log("eligibility", `Rule skipped (disabled): ${rule.name}`);
      continue;
    }
    const result = runRule(rule, applicant);
    log("eligibility", `${result.pass ? "PASS" : "FAIL"}: ${rule.name}${result.reason ? " (" + result.reason + ")" : ""}`);
    if (!result.pass) failures.push({ rule: rule.name, reason: result.reason });
  }

  if (failures.length > 0) {
    log("decision", `Declined on ${failures.length} eligibility rule(s)`);
    return {
      decision: "DECLINED",
      stage: "eligibility",
      reasons: failures,
      score: null,
      breakdown: null,
      pricing: null,
      partner: null,
      trace,
      totalMs: Date.now() - t0,
    };
  }

  // ---- Stage 2: scorecard ----
  const { score, breakdown } = scoreApplicant(applicant, config.scorecard);
  breakdown.forEach((b) =>
    log("scorecard", `${b.factor}: ${b.points.toFixed(1)} / ${b.weight}`)
  );
  log("scorecard", `Total score: ${score.toFixed(1)} / 100`);

  // ---- Stage 3: decision thresholds ----
  const { approveAt, reviewAt } = config.decisionThresholds;
  let decision;
  if (score >= approveAt) decision = "APPROVED";
  else if (score >= reviewAt) decision = "REVIEW";
  else decision = "DECLINED";
  log("decision", `Score ${score.toFixed(1)} vs approve at ${approveAt}, review at ${reviewAt}: ${decision}`);

  // ---- Stage 4: pricing ----
  let pricing = null;
  if (decision === "APPROVED") {
    const tier = [...config.pricingTiers]
      .sort((a, b) => b.minScore - a.minScore)
      .find((t) => score >= t.minScore);
    pricing = tier
      ? { band: tier.band, apr: tier.apr, label: tier.label }
      : { band: "C", apr: config.pricingTiers.at(-1)?.apr ?? 13.49, label: "Entry" };
    log("pricing", `Assigned band ${pricing.band} (${pricing.label}) at ${pricing.apr}% APR`);
  }

  // ---- Stage 5: partner routing ----
  let partner = null;
  if (decision === "APPROVED") {
    partner =
      config.partnerRouting.find((p) =>
        p.destinations.includes(applicant.destination)
      ) || null;
    log("routing", partner ? `Routed to ${partner.name}` : "No partner found for destination; flagged for ops");
    if (!partner) decision = "REVIEW";
  }

  const totalMs = Date.now() - t0;
  log("complete", `Decision rendered in ${totalMs} ms`);

  return {
    decision,
    stage: "full-pipeline",
    reasons: [],
    score: Number(score.toFixed(1)),
    breakdown,
    pricing,
    partner: partner ? { id: partner.id, name: partner.name } : null,
    trace,
    totalMs,
  };
}

function labelDegree(d) {
  return { masters: "Masters", mba: "MBA", phd: "PhD", undergraduate: "Undergraduate" }[d] || "Graduate";
}
function labelField(f) {
  return { stem: "STEM", business: "Business", medicine: "Medicine", law: "Law", other: "another field" }[f] || "an unspecified field";
}

function runRule(rule, a) {
  const amount = Number(a.loanAmount) || 0;
  switch (rule.id) {
    case "amount-range": {
      const { minAmount, maxAmount } = rule.params;
      if (amount < minAmount) return { pass: false, reason: `Amount below floor of $${minAmount.toLocaleString()}` };
      if (amount > maxAmount) return { pass: false, reason: `Amount above ceiling of $${maxAmount.toLocaleString()}` };
      return { pass: true };
    }
    case "supported-destination":
      return rule.params.destinations.includes(a.destination)
        ? { pass: true }
        : { pass: false, reason: `No active partner for destination ${a.destination}` };
    case "admit-confirmed":
      return a.admitConfirmed
        ? { pass: true }
        : { pass: false, reason: "Admission not yet confirmed" };
    case "enrollment-window": {
      const months = Number(a.monthsToGraduation);
      if (!Number.isFinite(months) || months <= 0)
        return { pass: false, reason: "Expected graduation must be in the future" };
      const max = rule.params.maxMonthsToGraduation ?? 48;
      return months <= max
        ? { pass: true }
        : { pass: false, reason: `Graduation ${months} months out exceeds the ${max}-month window` };
    }
    case "graduate-only":
      return a.degreeLevel !== "undergraduate"
        ? { pass: true }
        : { pass: false, reason: "Undergraduate programs are not currently eligible" };
    case "school-tier":
      return Number(a.schoolTier) <= rule.params.maxTier
        ? { pass: true }
        : { pass: false, reason: `School tier ${a.schoolTier} is below the minimum (tier ${rule.params.maxTier} or better)` };
    default:
      return { pass: true };
  }
}

function scoreApplicant(a, scorecard) {
  const w = scorecard.weights;
  const factors = [];

  // School tier: tier 1 -> 1.0, tier 2 -> 0.7, tier 3 -> 0.4, unranked -> 0.2
  const tierScore = { 1: 1.0, 2: 0.7, 3: 0.4 }[Number(a.schoolTier)] ?? 0.2;
  factors.push({ factor: "School tier", raw: tierScore, weight: w.schoolTier });

  // Field of study x degree level: a salary-potential proxy.
  const fieldBase = scorecard.fieldScores?.[a.fieldOfStudy] ?? 0.55;
  const degreeMult = scorecard.degreeMultipliers?.[a.degreeLevel] ?? 0.9;
  const fieldScore = Math.min(1, fieldBase * degreeMult);
  factors.push({ factor: "Field of study", raw: fieldScore, weight: w.fieldOfStudy });

  // Credit history
  const creditScore = { established: 1.0, thin: 0.6, none: 0.3 }[a.creditHistory] ?? 0.3;
  factors.push({ factor: "Credit history", raw: creditScore, weight: w.creditHistory });

  // Income coverage: household income relative to loan amount
  const amount = Number(a.loanAmount) || 1;
  const income = Number(a.householdIncome) || 0;
  const coverage = Math.max(0, Math.min(1, income / amount / 1.5));
  factors.push({ factor: "Income coverage", raw: coverage, weight: w.incomeCoverage });

  // Work experience: repayment capacity and employability signal
  const years = Number(a.workExpYears) || 0;
  const workScore = years >= 6 ? 1.0 : years >= 3 ? 0.85 : years >= 1 ? 0.6 : 0.4;
  factors.push({ factor: "Work experience", raw: workScore, weight: w.workExperience });

  // Country risk
  let riskScore = 0.5;
  if (scorecard.countryRisk.low.includes(a.citizenship)) riskScore = 1.0;
  else if (scorecard.countryRisk.medium.includes(a.citizenship)) riskScore = 0.7;
  factors.push({ factor: "Country risk", raw: riskScore, weight: w.countryRisk });

  const breakdown = factors.map((f) => ({
    factor: f.factor,
    weight: f.weight,
    points: f.raw * f.weight,
  }));
  const score = breakdown.reduce((s, b) => s + b.points, 0);
  return { score, breakdown };
}
