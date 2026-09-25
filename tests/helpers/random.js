// Seeded random applicants for property tests.
// mulberry32 is a tiny, well-known 32-bit PRNG. A fixed seed keeps every run
// reproducible, so a failing case can be replayed exactly.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CITIZENSHIPS = ["IN", "CN", "BR", "NG", "VN", "XX"];
export const DESTINATIONS = ["US", "CA", "GB"];
export const DEGREES = ["masters", "mba", "phd", "undergraduate"];
export const FIELDS = ["stem", "business", "medicine", "law", "other"];
export const CREDITS = ["established", "thin", "none"];
export const MONTHS = [-3, 6, 12, 18, 24, 36, 48, 60];

export function makeRng(seed) {
  const r = mulberry32(seed);
  const int = (min, max) => min + Math.floor(r() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return { r, int, pick };
}

// Numeric fields arrive as strings from the form, the same shape the golden
// scenarios use, so the random applicants exercise the same code path.
// Every generated applicant is valid under applicantSchema (checked in
// tests/bounds.test.js).
export function randomApplicant(rng) {
  const { int, pick, r } = rng;
  return {
    citizenship: pick(CITIZENSHIPS),
    destination: pick(DESTINATIONS),
    degreeLevel: pick(DEGREES),
    fieldOfStudy: pick(FIELDS),
    schoolTier: String(int(1, 4)),
    monthsToGraduation: String(pick(MONTHS)),
    loanAmount: String(int(1000, 150000)),
    // 0 (no income) or a realistic $1,000 to $200,000; $1 to $999 is refused
    // by the schema as a likely typo.
    householdIncome: String(r() < 0.1 ? 0 : int(1000, 200000)),
    creditHistory: pick(CREDITS),
    workExpYears: String(int(0, 15)),
    admitConfirmed: r() < 0.5,
  };
}

export function randomApplicants(seed, n) {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => randomApplicant(rng));
}

export const RANK = { DECLINED: 0, REVIEW: 1, APPROVED: 2 };

export function clone(x) {
  return structuredClone(x);
}
