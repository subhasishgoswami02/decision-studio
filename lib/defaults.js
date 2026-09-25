// Default decisioning configuration.
// Everything here is editable from the Rules Console at runtime.
// "Rollback to defaults" restores this exact object.

export const DEFAULT_CONFIG = {
  version: "2.1",
  eligibilityRules: [
    {
      id: "amount-range",
      name: "Loan amount within program limits",
      description: "Requested amount must be between the floor and ceiling.",
      enabled: true,
      params: { minAmount: 5000, maxAmount: 100000 },
    },
    {
      id: "supported-destination",
      name: "Supported study destination",
      description: "Applicants must be studying in one of the accepted destinations.",
      enabled: true,
      params: { destinations: ["US", "CA"] },
    },
    {
      id: "admit-confirmed",
      name: "Admission confirmed",
      description: "Applicant must hold a confirmed admit from an eligible school.",
      enabled: true,
      params: {},
    },
    {
      id: "enrollment-window",
      name: "Within enrollment window",
      description: "Expected graduation must fall inside the configured window. Too far out means income is too distant to underwrite.",
      enabled: true,
      params: { maxMonthsToGraduation: 48 },
    },
    {
      id: "graduate-only",
      name: "Graduate programs only",
      description: "When on, undergraduate applicants are declined.",
      enabled: false,
      params: {},
    },
    {
      id: "school-tier",
      name: "Minimum school tier",
      description: "School must be at or above the configured tier (1 is best).",
      enabled: true,
      params: { maxTier: 3 },
    },
  ],
  scorecard: {
    // Weights sum to 100. Each factor returns 0 to 1, multiplied by its weight.
    weights: {
      schoolTier: 25,
      fieldOfStudy: 15,
      creditHistory: 20,
      incomeCoverage: 20,
      workExperience: 10,
      countryRisk: 10,
    },
    // Salary-potential proxy by field, adjusted by degree level.
    fieldScores: { stem: 1.0, medicine: 1.0, business: 0.85, law: 0.7, other: 0.55 },
    degreeMultipliers: { phd: 1.0, masters: 1.0, mba: 0.95, undergraduate: 0.7 },
    countryRisk: {
      low: ["IN", "CN", "KR", "JP", "DE", "FR", "GB", "SG", "AE"],
      medium: ["BR", "MX", "VN", "ID", "NG", "KE", "GH", "BD", "NP", "PK", "LK", "EG"],
    },
  },
  decisionThresholds: {
    approveAt: 65,
    reviewAt: 50,
  },
  pricingTiers: [
    { band: "A", minScore: 80, apr: 9.49, label: "Prime" },
    { band: "B", minScore: 70, apr: 11.49, label: "Standard" },
    { band: "C", minScore: 65, apr: 13.49, label: "Entry" },
  ],
  partnerRouting: [
    { id: "partner-us", name: "US Bank Partner", destinations: ["US"] },
    { id: "partner-ca", name: "Canada Bank Partner", destinations: ["CA"] },
  ],
};
