// Pure decisioning engine. No I/O, fully deterministic, fully traceable.
// The trace is the point: every decision explains itself.

export function decide(applicant, config) {
  const t0 = Date.now();
  const trace = [];
  const log = (step, detail) =>
    trace.push({ step, detail, elapsedMs: Date.now() - t0 });

  log("intake", `Application received for ${applicant.destination} destination, amount $${Number(applicant.loanAmount).toLocaleString()}`);

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
    pricing,
    partner: partner ? { id: partner.id, name: partner.name } : null,
    trace,
    totalMs,
  };
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
    case "graduate-only":
      return a.program === "graduate"
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

  // School tier: tier 1 -> 1.0, tier 2 -> 0.7, tier 3 -> 0.4
  const tierScore = { 1: 1.0, 2: 0.7, 3: 0.4 }[Number(a.schoolTier)] ?? 0.2;
  factors.push({ factor: "School tier", raw: tierScore, weight: w.schoolTier });

  // Credit history
  const creditScore = { established: 1.0, thin: 0.6, none: 0.3 }[a.creditHistory] ?? 0.3;
  factors.push({ factor: "Credit history", raw: creditScore, weight: w.creditHistory });

  // Income coverage: household income relative to loan amount
  const amount = Number(a.loanAmount) || 1;
  const income = Number(a.householdIncome) || 0;
  const ratio = income / amount;
  const coverage = Math.max(0, Math.min(1, ratio / 1.5));
  factors.push({ factor: "Income coverage", raw: coverage, weight: w.incomeCoverage });

  // Program
  const programScore = a.program === "graduate" ? 1.0 : 0.6;
  factors.push({ factor: "Program", raw: programScore, weight: w.program });

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
