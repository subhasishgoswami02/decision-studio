import { useEffect, useState } from "react";
import { DEFAULT_CONFIG } from "../lib/defaults";

const BLANK = {
  citizenship: "IN",
  destination: "US",
  degreeLevel: "masters",
  fieldOfStudy: "stem",
  schoolTier: "1",
  monthsToGraduation: "18",
  loanAmount: "45000",
  householdIncome: "30000",
  creditHistory: "thin",
  workExpYears: "3",
  admitConfirmed: true,
};

export default function Apply() {
  const [form, setForm] = useState(BLANK);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [configSource, setConfigSource] = useState("defaults");

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("ds-config")) {
      setConfigSource("rules console");
    }
  }, []);

  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const saved = typeof window !== "undefined" ? localStorage.getItem("ds-config") : null;
    const config = saved ? JSON.parse(saved) : DEFAULT_CONFIG;
    const res = await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicant: { ...form }, config }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="grid">
      <section className="card">
        <h1>Loan application</h1>
        <p className="muted">
          Submit an application and get a decision in milliseconds, with a full
          audit trace. Active configuration: <strong>{configSource}</strong>.
        </p>
        <form onSubmit={submit}>
          <h2>Program</h2>
          <div className="row">
            <label>Study destination
              <select value={form.destination} onChange={set("destination")}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="UK">United Kingdom</option>
              </select>
            </label>
            <label>Degree level
              <select value={form.degreeLevel} onChange={set("degreeLevel")}>
                <option value="masters">Masters</option>
                <option value="mba">MBA</option>
                <option value="phd">PhD</option>
                <option value="undergraduate">Undergraduate</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Field of study
              <select value={form.fieldOfStudy} onChange={set("fieldOfStudy")}>
                <option value="stem">STEM</option>
                <option value="business">Business</option>
                <option value="medicine">Medicine</option>
                <option value="law">Law</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>School tier
              <select value={form.schoolTier} onChange={set("schoolTier")}>
                <option value="1">Tier 1</option>
                <option value="2">Tier 2</option>
                <option value="3">Tier 3</option>
                <option value="4">Unranked</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Expected graduation
              <select value={form.monthsToGraduation} onChange={set("monthsToGraduation")}>
                <option value="6">Within 6 months</option>
                <option value="12">In about a year</option>
                <option value="18">In about 18 months</option>
                <option value="24">In about 2 years</option>
                <option value="36">In about 3 years</option>
                <option value="60">In 5+ years</option>
                <option value="-3">Already graduated</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.admitConfirmed} onChange={set("admitConfirmed")} />
              Admission confirmed
            </label>
          </div>

          <h2>Applicant profile</h2>
          <div className="row">
            <label>Citizenship
              <select value={form.citizenship} onChange={set("citizenship")}>
                <option value="IN">India</option>
                <option value="CN">China</option>
                <option value="BR">Brazil</option>
                <option value="NG">Nigeria</option>
                <option value="VN">Vietnam</option>
                <option value="XX">Other</option>
              </select>
            </label>
            <label>Credit history
              <select value={form.creditHistory} onChange={set("creditHistory")}>
                <option value="established">Established</option>
                <option value="thin">Thin file</option>
                <option value="none">No history</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Work experience (years)
              <input type="number" min="0" max="40" value={form.workExpYears} onChange={set("workExpYears")} />
            </label>
            <label>Household income (USD/yr)
              <input type="number" min="0" value={form.householdIncome} onChange={set("householdIncome")} />
            </label>
          </div>

          <h2>Loan</h2>
          <div className="row">
            <label>Loan amount (USD)
              <input type="number" min="0" value={form.loanAmount} onChange={set("loanAmount")} />
            </label>
          </div>
          <button className="primary" disabled={loading}>
            {loading ? "Deciding..." : "Get my decision"}
          </button>
        </form>
      </section>

      <section className="card">
        <h1>Decision</h1>
        {!result && <p className="muted">Submit an application to see the decision and its trace. Tip: open the Rules Console, change a rule, and resubmit. No deploy needed.</p>}
        {result && (
          <>
            <div className={`badge ${result.decision?.toLowerCase()}`}>{result.decision}</div>
            <p className="latency">Rendered in {result.totalMs} ms</p>
            {result.score != null && (
              <p><strong>Score:</strong> {result.score} / 100</p>
            )}
            {result.breakdown && (
              <div className="factors">
                {result.breakdown.map((b) => (
                  <div className="factor" key={b.factor}>
                    <span className="factor-name">{b.factor}</span>
                    <span className="factor-bar" aria-hidden="true">
                      <span className="factor-fill" style={{ width: `${(b.points / b.weight) * 100}%` }} />
                    </span>
                    <span className="factor-pts">{b.points.toFixed(1)}/{b.weight}</span>
                  </div>
                ))}
              </div>
            )}
            {result.pricing && (
              <p><strong>Pricing:</strong> Band {result.pricing.band} ({result.pricing.label}), {result.pricing.apr}% APR</p>
            )}
            {result.partner && (
              <p><strong>Routed to:</strong> {result.partner.name}</p>
            )}
            {result.reasons?.length > 0 && (
              <ul className="reasons">
                {result.reasons.map((r, i) => (
                  <li key={i}><strong>{r.rule}:</strong> {r.reason}</li>
                ))}
              </ul>
            )}
            <h2>Decision trace</h2>
            <ol className="trace">
              {result.trace?.map((t, i) => (
                <li key={i}>
                  <span className={`step step-${t.step}`}>{t.step}</span>
                  <span>{t.detail}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
