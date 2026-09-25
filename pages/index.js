import { useRef, useState } from "react";
import Link from "next/link";
import DecisionView, { announce } from "../components/DecisionView";
import { applicantSchema, fieldErrors } from "../lib/validate";
import { PRESETS, scenarioById } from "../lib/scenarios";
import { usePolicy } from "../lib/usePolicy";

const START = scenarioById("thin-file").applicant;

const FIELD_ORDER = [
  "destination",
  "degreeLevel",
  "fieldOfStudy",
  "schoolTier",
  "monthsToGraduation",
  "admitConfirmed",
  "citizenship",
  "creditHistory",
  "workExpYears",
  "householdIncome",
  "loanAmount",
];

export default function Apply() {
  const policy = usePolicy();
  const [form, setForm] = useState(START);
  const [activePreset, setActivePreset] = useState(null);
  const [errors, setErrors] = useState({});
  const [showSummary, setShowSummary] = useState(false);
  const [result, setResult] = useState(null);
  const [roundTrip, setRoundTrip] = useState(null);
  const [failure, setFailure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [stale, setStale] = useState(false);
  const summaryRef = useRef(null);
  const resultRef = useRef(null);
  const headingRef = useRef(null);
  const lastRequest = useRef(null);

  const set = (k) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    setActivePreset(null);
    if (result) setStale(true);
    if (errors[k]) setErrors((errs) => ({ ...errs, [k]: undefined }));
  };

  async function run(values, { focusResult = false } = {}) {
    const parsed = applicantSchema.safeParse(values);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      setShowSummary(true);
      setResult(null);
      setStale(false);
      setStatus("");
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    setShowSummary(false);
    setLoading(true);
    setFailure(null);
    setStatus("Deciding");
    lastRequest.current = values;

    const body = { applicant: parsed.data };
    if (policy.source === "custom") body.config = policy.config;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.decision) {
        throw Object.assign(new Error("request failed"), { status: res.status, data });
      }
      setRoundTrip(performance.now() - t0);
      setResult(data);
      setStale(false);
      setStatus(announce(data, policy.config.decisionThresholds));
      if (focusResult) {
        // The button that asked for this is gone, so move focus to the answer.
        requestAnimationFrame(() => headingRef.current?.focus());
      } else if (window.matchMedia("(max-width: 980px)").matches) {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
      }
    } catch (err) {
      setResult(null);
      setStale(false);
      setFailure(describeFailure(err));
      setStatus(""); // the alert in the decision panel announces it
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (loading) return;
    run(form);
  }

  function applyPreset(p) {
    if (loading) return;
    setForm(p.applicant);
    setActivePreset(p.id);
    setErrors({});
    run(p.applicant);
  }

  function tryAmount(amount) {
    if (loading) return;
    const next = { ...form, loanAmount: String(amount) };
    setForm(next);
    setActivePreset(null);
    run(next, { focusResult: true });
  }

  const errorList = FIELD_ORDER.filter((k) => errors[k]);
  const HINTS = { householdIncome: true, loanAmount: true };
  const fieldProps = (k) => {
    const ids = [HINTS[k] ? `${k}-hint` : null, errors[k] ? `${k}-error` : null].filter(Boolean);
    return {
      id: k,
      name: k,
      "aria-invalid": errors[k] ? "true" : undefined,
      "aria-describedby": ids.length ? ids.join(" ") : undefined,
    };
  };
  const fieldError = (k) =>
    errors[k] ? (
      <p className="field-error" id={`${k}-error`}>
        {errors[k]}
      </p>
    ) : null;

  const t = policy.config.decisionThresholds;
  const range = policy.config.eligibilityRules.find((r) => r.id === "amount-range" && r.enabled)?.params;

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">
          <span className="live-dot" aria-hidden="true" /> Live demo, rules-based credit decisioning
        </p>
        <h1>Decide a student loan in milliseconds, and see exactly why.</h1>
        <p className="lede">
          Pick a sample applicant or fill in your own. Every decision shows each rule it checked, the score behind it,
          and what would change the outcome.
        </p>
        <ol className="pipeline" aria-label="How a decision is made">
          <li><span>Eligibility</span></li>
          <li><span>Scorecard</span></li>
          <li><span>Thresholds</span></li>
          <li><span>Pricing</span></li>
          <li><span>Routing</span></li>
        </ol>
        <p className="policy-pill" style={policy.ready ? undefined : { visibility: "hidden" }}>
          Active policy:{" "}
          {policy.source === "custom" ? (
            <>
              <span className="tag edited">Edited</span>
              <span>
                {policy.changes} setting{policy.changes === 1 ? "" : "s"} changed in the{" "}
                <Link href="/rules">rules console</Link>
              </span>
            </>
          ) : (
            <>
              <span className="tag">Default</span>
              <span>
                Change it in the <Link href="/rules">rules console</Link>, no deploy needed
              </span>
            </>
          )}
        </p>
      </header>

      {policy.notice && <p className="notice" role="status">{policy.notice}</p>}

      <section className="presets" aria-labelledby="presets-h">
        <h2 className="presets-label" id="presets-h">Try a sample applicant</h2>
        <ul className="preset-list">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="preset"
                aria-pressed={activePreset === p.id}
                onClick={() => applyPreset(p)}
                aria-disabled={loading ? "true" : undefined}
              >
                <strong>{p.name}</strong>
                <small>{p.summary}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="workspace">
        <section className="card" aria-labelledby="form-h">
          <h2 className="card-title" id="form-h">Application</h2>
          <p className="card-sub" style={{ marginBottom: 18 }}>All amounts in US dollars.</p>

          {showSummary && errorList.length > 0 && (
            <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <h3>Fix {errorList.length === 1 ? "this" : `these ${errorList.length}`} before deciding</h3>
              <ul>
                {errorList.map((k) => (
                  <li key={k}>
                    <a href={`#${k}`}>{errors[k]}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <fieldset>
              <legend>Program</legend>
              <div className="row">
                <div className="field">
                  <label htmlFor="destination">Study destination</label>
                  <select {...fieldProps("destination")} value={form.destination} onChange={set("destination")}>
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                    <option value="GB">United Kingdom</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="degreeLevel">Degree level</label>
                  <select {...fieldProps("degreeLevel")} value={form.degreeLevel} onChange={set("degreeLevel")}>
                    <option value="masters">Master&apos;s</option>
                    <option value="mba">MBA</option>
                    <option value="phd">PhD</option>
                    <option value="undergraduate">Undergraduate</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="fieldOfStudy">Field of study</label>
                  <select {...fieldProps("fieldOfStudy")} value={form.fieldOfStudy} onChange={set("fieldOfStudy")}>
                    <option value="stem">STEM</option>
                    <option value="business">Business</option>
                    <option value="medicine">Medicine</option>
                    <option value="law">Law</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="schoolTier">School tier</label>
                  <select {...fieldProps("schoolTier")} value={form.schoolTier} onChange={set("schoolTier")}>
                    <option value="1">Tier 1</option>
                    <option value="2">Tier 2</option>
                    <option value="3">Tier 3</option>
                    <option value="4">Unranked</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="monthsToGraduation">Expected graduation</label>
                  <select
                    {...fieldProps("monthsToGraduation")}
                    value={form.monthsToGraduation}
                    onChange={set("monthsToGraduation")}
                  >
                    <option value="6">Within 6 months</option>
                    <option value="12">In about a year</option>
                    <option value="18">In about 18 months</option>
                    <option value="24">In about 2 years</option>
                    <option value="36">In about 3 years</option>
                    <option value="48">In about 4 years</option>
                    <option value="60">In 5 or more years</option>
                    <option value="-3">Already graduated</option>
                  </select>
                </div>
                <div className="field check-cell">
                  <label className="check" htmlFor="admitConfirmed">
                    <input
                      type="checkbox"
                      id="admitConfirmed"
                      name="admitConfirmed"
                      checked={form.admitConfirmed}
                      onChange={set("admitConfirmed")}
                    />
                    Admission confirmed
                  </label>
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend>Applicant</legend>
              <div className="row">
                <div className="field">
                  <label htmlFor="citizenship">Citizenship</label>
                  <select {...fieldProps("citizenship")} value={form.citizenship} onChange={set("citizenship")}>
                    <option value="IN">India</option>
                    <option value="CN">China</option>
                    <option value="BR">Brazil</option>
                    <option value="NG">Nigeria</option>
                    <option value="VN">Vietnam</option>
                    <option value="XX">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="creditHistory">Credit history</label>
                  <select {...fieldProps("creditHistory")} value={form.creditHistory} onChange={set("creditHistory")}>
                    <option value="established">Established</option>
                    <option value="thin">Thin file</option>
                    <option value="none">No history</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="workExpYears">Work experience, years</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="40"
                    step="0.5"
                    {...fieldProps("workExpYears")}
                    value={form.workExpYears}
                    onChange={set("workExpYears")}
                  />
                  {fieldError("workExpYears")}
                </div>
                <div className="field">
                  <label htmlFor="householdIncome">Household income per year</label>
                  <div className="money">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="10000000"
                      step="1000"
                      {...fieldProps("householdIncome")}
                      value={form.householdIncome}
                      onChange={set("householdIncome")}
                    />
                  </div>
                  <p className="hint" id="householdIncome-hint">Enter 0 if there is none.</p>
                  {fieldError("householdIncome")}
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend>Loan</legend>
              <div className="row">
                <div className="field">
                  <label htmlFor="loanAmount">Loan amount</label>
                  <div className="money">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1000"
                      max="500000"
                      step="1000"
                      {...fieldProps("loanAmount")}
                      value={form.loanAmount}
                      onChange={set("loanAmount")}
                    />
                  </div>
                  <p className="hint" id="loanAmount-hint">
                    $1,000 to $500,000.
                    {range ? ` The active policy lends $${range.minAmount.toLocaleString("en-US")} to $${range.maxAmount.toLocaleString("en-US")}.` : ""}
                  </p>
                  {fieldError("loanAmount")}
                </div>
              </div>
            </fieldset>

            <div className="actions">
              <button className="btn btn-primary" type="submit" aria-disabled={loading ? "true" : undefined}>
                {loading ? "Deciding" : "Get decision"}
              </button>
            </div>
          </form>
        </section>

        <section
          className={`card sticky-col${stale && result ? " is-stale-card" : ""}`}
          aria-label="Decision result"
          ref={resultRef}
          aria-busy={loading}
        >
          {failure ? (
            <div>
              <h2 className="card-title">Decision</h2>
              <div className="alert" role="alert">
                <p>
                  <strong>{failure.title}</strong> {failure.body}
                </p>
                {failure.retry && lastRequest.current && (
                  <div>
                    <button type="button" className="btn btn-secondary" onClick={() => run(lastRequest.current)}>
                      Try again
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : result ? (
            <div className={stale ? "is-stale" : undefined}>
              {stale && (
                <p className="stale-note">
                  The form changed since this decision. <strong>Get decision</strong> to update it.
                </p>
              )}
            <DecisionView
              result={result}
              thresholds={t}
              roundTripMs={roundTrip}
              onTryAmount={tryAmount}
              headingRef={headingRef}
            />
            </div>
          ) : (
            <div className="empty">
              <h2 className="card-title">Decision</h2>
              <p>No decision yet. Choose a sample applicant above, or submit the form. The engine runs five steps:</p>
              <ol>
                <li><strong>Eligibility.</strong> Knockout rules: amount, destination, admission, enrollment window, school tier.</li>
                <li><strong>Scorecard.</strong> Six weighted factors add up to a score out of 100.</li>
                <li><strong>Thresholds.</strong> Approve at {t.approveAt} or more, review from {t.reviewAt}, decline below.</li>
                <li><strong>Pricing.</strong> Higher scores get a lower rate band.</li>
                <li><strong>Routing.</strong> The loan goes to the partner that covers the destination.</li>
              </ol>
            </div>
          )}
        </section>
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>
    </>
  );
}

function describeFailure(err) {
  if (err?.name === "AbortError") {
    return { title: "That took too long.", body: "The decision service did not answer within 10 seconds.", retry: true };
  }
  if (err?.status === 429) {
    return { title: "Too many requests.", body: "Wait a minute, then try again.", retry: true };
  }
  if (err?.status === 400) {
    const first = err.data?.issues?.[0];
    const where = first?.path?.startsWith("config") ? " Your edited rules may be invalid; reset them in the rules console." : "";
    return {
      title: "Some inputs weren't accepted.",
      body: `${first ? first.message + "." : "Check the form and try again."}${where}`,
      retry: false,
    };
  }
  if (err?.status) {
    return { title: "The decision service had a problem.", body: "Nothing you did caused it. Try again in a moment.", retry: true };
  }
  return { title: "Couldn't reach the decision service.", body: "Check your connection and try again.", retry: true };
}
