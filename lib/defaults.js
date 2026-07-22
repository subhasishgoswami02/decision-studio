// Default decisioning configuration.
// Everything here is editable from the Rules Console at runtime.
// "Rollback to defaults" restores this exact object.

export const DEFAULT_CONFIG = {
  version: "1.0",
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
      description: "Only destinations with an active lending partner are eligible.",
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
      id: "graduate-only",
      name: "Graduate programs only",
      description: "When enabled, undergraduate applicants are declined.",
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
      schoolTier: 30,
      creditHistory: 25,
      incomeCoverage: 25,
      program: 10,
      countryRisk: 10,
    },
    countryRisk: {
      // Lower risk means a higher factor score.
      low: ["IN", "CN", "KR", "JP", "DE", "FR", "GB", "SG", "AE"],
      medium: ["BR", "MX", "VN", "ID", "NG", "KE", "GH", "BD", "NP", "PK", "LK", "EG"],
      // Everything else scores as "other".
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
