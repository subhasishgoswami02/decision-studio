import { useEffect, useState } from "react";
import { DEFAULT_CONFIG } from "../lib/defaults";

const BLANK = {
  citizenship: "IN",
  destination: "US",
  program: "graduate",
  schoolTier: "1",
  loanAmount: "45000",
  householdIncome: "30000",
  creditHistory: "thin",
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
            <label>Study destination
              <select value={form.destination} onChange={set("destination")}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="UK">United Kingdom</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Program
              <select value={form.program} onChange={set("program")}>
                <option value="graduate">Graduate</option>
                <option value="undergraduate">Undergraduate</option>
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
            <label>Loan amount (USD)
              <input type="number" value={form.loanAmount} onChange={set("loanAmount")} min="0" />
            </label>
            <label>Household income (USD/yr)
              <input type="number" value={form.householdIncome} onChange={set("householdIncome")} min="0" />
            </label>
          </div>
          <div className="row">
            <label>Credit history
              <select value={form.creditHistory} onChange={set("creditHistory")}>
                <option value="established">Established</option>
                <option value="thin">Thin file</option>
                <option value="none">No history</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.admitConfirmed} onChange={set("admitConfirmed")} />
              Admission confirmed
            </label>
          </div>
          <button className="primary" disabled={loading}>
            {loading ? "Deciding..." : "Get decision"}
          </button>
        </form>
      </section>

      <section className="card">
        <h1>Decision</h1>
        {!result && <p className="muted">Submit an application to see the decision and its trace.</p>}
        {result && (
          <>
            <div className={`badge ${result.decision?.toLowerCase()}`}>{result.decision}</div>
            <p className="latency">Rendered in {result.totalMs} ms</p>
            {result.score != null && (
              <p><strong>Score:</strong> {result.score} / 100</p>
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
