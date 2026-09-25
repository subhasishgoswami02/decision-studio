import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DecisionView, { announce } from "../components/DecisionView";
import { Segmented, Range, Steps, Toggle } from "../components/Controls";
import { applicantSchema, fieldErrors } from "../lib/validate";
import { PRESETS, scenarioById } from "../lib/scenarios";
import { decide } from "../lib/engine";
import { suggestChange } from "../lib/counterfactual";
import { usePolicy } from "../lib/usePolicy";

// The page opens on a real decision, not an empty form: Borderline shows
// every part of the result (score, review line, counterfactual, trace).
const OPENING = "borderline-review";

const usd = (n) => `$${Number(n).toLocaleString("en-US")}`;
const usdShort = (n) => (n >= 1000 && n % 1000 === 0 ? `$${(n / 1000).toLocaleString("en-US")}K` : usd(n));
const years = (n) => (n === 1 ? "1 year" : `${n} years`);

const GRADUATION = [
  { value: "-3", label: "Already graduated" },
  { value: "6", label: "Within 6 months" },
  { value: "12", label: "In about a year" },
  { value: "18", label: "In about 18 months" },
  { value: "24", label: "In about 2 years" },
  { value: "36", label: "In about 3 years" },
  { value: "48", label: "In about 4 years" },
  { value: "60", label: "In 5 or more years" },
];

const OUTCOME_DOT = { APPROVED: "ok", REVIEW: "warn", DECLINED: "bad" };
const WORDS = { APPROVED: "Approved", REVIEW: "Sent to review", DECLINED: "Declined" };

function sameResult(a, b) {
  if (!a || !b) return false;
  return (
    a.decision === b.decision &&
    a.score === b.score &&
    a.stage === b.stage &&
    (a.pricing?.band ?? null) === (b.pricing?.band ?? null) &&
    JSON.stringify(a.breakdown?.map((x) => x.points) ?? null) === JSON.stringify(b.breakdown?.map((x) => x.points) ?? null) &&
    JSON.stringify(a.reasons?.map((r) => r.ruleId) ?? []) === JSON.stringify(b.reasons?.map((r) => r.ruleId) ?? [])
  );
}

export default function Apply() {
  const policy = usePolicy();
  const [form, setForm] = useState(scenarioById(OPENING).applicant);
  const [activePreset, setActivePreset] = useState(OPENING);
  // Deltas are measured against the last sample picked, so a series of small
  // slider moves still reads as one change ("up 3.3 vs Borderline").
  const [baselineId, setBaselineId] = useState(OPENING);
  const [check, setCheck] = useState(null);
  const [status, setStatus] = useState("");
  const [showBar, setShowBar] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const resultRef = useRef(null);
  const headingRef = useRef(null);
  const focusAfter = useRef(false);
  const announced = useRef(false);

  const thresholds = policy.config.decisionThresholds;
  const range = policy.config.eligibilityRules.find((r) => r.id === "amount-range" && r.enabled)?.params;
  // Loan hint: quiet inside the policy range, a clear warning outside it.
  const loanHint = (() => {
    if (!range) return { text: "The amount rule is switched off in the rules console, so any amount passes it.", tone: null };
    const amt = Number(form.loanAmount);
    if (form.loanAmount !== "" && Number.isFinite(amt)) {
      if (amt > range.maxAmount)
        return { text: `Over the policy's ${usd(range.maxAmount)} limit, so this is declined on amount.`, tone: "warn" };
      if (amt < range.minAmount)
        return { text: `Under the policy's ${usd(range.minAmount)} minimum, so this is declined on amount.`, tone: "warn" };
    }
    return { text: `This policy lends ${usd(range.minAmount)} to ${usd(range.maxAmount)}.`, tone: null };
  })();

  // Validate and decide on every change. The engine is pure and takes well
  // under a millisecond, so it runs right here in the browser.
  const parsed = useMemo(() => applicantSchema.safeParse(form), [form]);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  const live = useMemo(() => {
    if (!parsed.success) return null;
    const t0 = performance.now();
    const r = decide(parsed.data, policy.config);
    const suggestion = suggestChange(parsed.data, policy.config, r);
    return { ...r, suggestion, localMs: performance.now() - t0 };
  }, [parsed, policy.config]);

  // Keep the last good result on screen while a field is being fixed, and
  // remember the one before it so changes show as deltas.
  const [hist, setHist] = useState({ curr: live });
  useEffect(() => {
    if (live) setHist({ curr: live });
  }, [live]);
  const shown = live || hist.curr;
  const stale = !live && !!shown;
  const baselineScenario = scenarioById(baselineId);
  const baseline = useMemo(
    () => (baselineScenario ? decide(baselineScenario.applicant, policy.config) : null),
    [baselineScenario, policy.config]
  );

  // Then confirm with the decision API, once the inputs settle.
  const apiKey = parsed.success
    ? JSON.stringify({ a: parsed.data, c: policy.source === "custom" ? policy.config : null })
    : null;
  useEffect(() => {
    if (!apiKey || !policy.ready || !live) return undefined;
    setCheck({ state: "pending" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const body = { applicant: parsed.data };
      if (policy.source === "custom") body.config = policy.config;
      const t0 = performance.now();
      try {
        const res = await fetch("/api/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.decision) throw Object.assign(new Error("request failed"), { status: res.status });
        const same = sameResult(data, live);
        setCheck({ state: same ? "ok" : "mismatch", ms: performance.now() - t0 });
        // The opening decision is on screen already; announce changes only.
        if (announced.current) setStatus(announce(live, thresholds));
      } catch (err) {
        if (err?.name === "AbortError") return;
        setCheck({ state: "error", status: err?.status });
        if (announced.current) setStatus(`${announce(live, thresholds)} Not yet confirmed by the server.`);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // apiKey captures every input the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, policy.ready]);

  // After "Set the loan to $X" the button disappears, so move focus to the answer.
  useEffect(() => {
    if (focusAfter.current && live) {
      focusAfter.current = false;
      requestAnimationFrame(() => headingRef.current?.focus());
    }
  }, [live]);

  // On narrow screens, a bar keeps the outcome in view while you edit.
  useEffect(() => {
    const el = resultRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 720px)");
    const io = new IntersectionObserver(([entry]) => setShowBar(mq.matches && !entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const set = (k) => (v) => {
    announced.current = true;
    setForm((f) => ({ ...f, [k]: v }));
    setActivePreset(null);
  };

  function applyPreset(p) {
    announced.current = true;
    setForm(p.applicant);
    setActivePreset(p.id);
    setBaselineId(p.id);
  }

  function tryAmount(amount) {
    focusAfter.current = true;
    announced.current = true;
    setForm((f) => ({ ...f, loanAmount: String(amount) }));
    setActivePreset(null);
  }

  function jumpToResult() {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }

  const preset = PRESETS.find((p) => p.id === activePreset);
  // Each sample's dot shows its outcome under the policy that is active now.
  const presetOutcome = useMemo(() => {
    const out = {};
    for (const p of PRESETS) out[p.id] = decide(p.applicant, policy.config).decision;
    return out;
  }, [policy.config]);
  const localMs = shown?.localMs;
  const timing = shown && mounted && !stale
    ? [
        `Decided in your browser in ${localMs == null || localMs < 1 ? "under 1" : localMs.toFixed(1)} ms.`,
        check?.state === "ok" && `Confirmed by the decision API in ${Math.round(check.ms)} ms.`,
        check?.state === "pending" && "Checking with the decision API.",
        check?.state === "mismatch" && "The decision API returned a different result. Reload the page.",
        check?.state === "error" &&
          (check.status === 429
            ? "The decision API is resting for a minute; this result comes from your browser."
            : "Couldn't reach the decision API; this result comes from your browser."),
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const outcomeWord = shown ? { APPROVED: "Approved", REVIEW: "Sent to review", DECLINED: "Declined" }[shown.decision] : "";

  return (
    <>
      <header className="page-head compact">
        <p className="eyebrow">
          <span className="live-dot" aria-hidden="true" /> Live demo, rules-based credit decisioning
        </p>
        <h1>Decide a student loan in milliseconds, and see exactly why.</h1>
        <p className="lede">
          Move any input and the decision updates as you go. Each result shows the rules it checked, the score behind
          it, and what would change it.
        </p>
        <p className="policy-pill" style={policy.ready ? undefined : { visibility: "hidden" }}>
          Policy:{" "}
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
                Edit it in the <Link href="/rules">rules console</Link>, no deploy needed
              </span>
            </>
          )}
        </p>
      </header>

      {policy.notice && <p className="notice" role="status">{policy.notice}</p>}

      <section className="presets" aria-labelledby="presets-h">
        <h2 className="presets-label" id="presets-h">
          Try a sample applicant
        </h2>
        <p className="presets-note" id="presets-note">
          Dot color is each sample&apos;s outcome under the active policy.
        </p>
        <ul className="chip-list" aria-describedby="presets-note">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button type="button" className="chip" aria-pressed={activePreset === p.id} onClick={() => applyPreset(p)}>
                <span className={`chip-dot ${OUTCOME_DOT[presetOutcome[p.id]]}`} aria-hidden="true" />
                {p.name}
                <span className="sr-only">, {WORDS[presetOutcome[p.id]].toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="preset-summary">{preset ? preset.summary : "Your own applicant. Pick a sample to reset."}</p>
      </section>

      <div className="app-grid">
        <section className="card controls" aria-labelledby="form-h">
          <h2 className="card-title" id="form-h">
            Applicant
          </h2>
          <p className="card-sub">All amounts in US dollars.</p>

          <div className="ctl-group">
            <h3 className="group-title">Loan</h3>
            <Range
              id="loanAmount"
              label="Loan amount"
              value={form.loanAmount}
              min={1000}
              max={150000}
              step={1000}
              display={usd}
              input={{ min: 1000, max: 500000 }}
              band={range ? [range.minAmount, range.maxAmount] : null}
              bandLabel={usdShort}
              onChange={set("loanAmount")}
              hint={loanHint.text}
              hintTone={loanHint.tone}
              error={errors.loanAmount}
            />
          </div>

          <div className="ctl-group">
            <h3 className="group-title">Program</h3>
            <Segmented
              name="destination"
              legend="Study destination"
              value={form.destination}
              onChange={set("destination")}
              options={[
                { value: "US", label: "United States" },
                { value: "CA", label: "Canada" },
                { value: "GB", label: "United Kingdom" },
              ]}
            />
            <Segmented
              name="degreeLevel"
              legend="Degree"
              value={form.degreeLevel}
              onChange={set("degreeLevel")}
              options={[
                { value: "masters", label: "Master's" },
                { value: "mba", label: "MBA" },
                { value: "phd", label: "PhD" },
                { value: "undergraduate", label: "Undergrad" },
              ]}
            />
            <Segmented
              name="fieldOfStudy"
              legend="Field of study"
              value={form.fieldOfStudy}
              onChange={set("fieldOfStudy")}
              options={[
                { value: "stem", label: "STEM" },
                { value: "business", label: "Business" },
                { value: "medicine", label: "Medicine" },
                { value: "law", label: "Law" },
                { value: "other", label: "Other" },
              ]}
            />
            <Segmented
              name="schoolTier"
              legend="School tier"
              value={String(form.schoolTier)}
              onChange={set("schoolTier")}
              options={[
                { value: "1", label: "Tier 1" },
                { value: "2", label: "Tier 2" },
                { value: "3", label: "Tier 3" },
                { value: "4", label: "Unranked" },
              ]}
            />
            <Steps
              id="monthsToGraduation"
              label="Expected graduation"
              value={String(form.monthsToGraduation)}
              steps={GRADUATION}
              onChange={set("monthsToGraduation")}
            />
            <Toggle id="admitConfirmed" label="Admission confirmed" checked={form.admitConfirmed} onChange={set("admitConfirmed")} />
          </div>

          <div className="ctl-group">
            <h3 className="group-title">Applicant</h3>
            <Segmented
              name="citizenship"
              legend="Citizenship"
              value={form.citizenship}
              onChange={set("citizenship")}
              compact
              options={[
                { value: "IN", label: "India" },
                { value: "CN", label: "China" },
                { value: "BR", label: "Brazil" },
                { value: "NG", label: "Nigeria" },
                { value: "VN", label: "Vietnam" },
                { value: "XX", label: "Other" },
              ]}
            />
            <Segmented
              name="creditHistory"
              legend="Credit history"
              value={form.creditHistory}
              onChange={set("creditHistory")}
              options={[
                { value: "established", label: "Established" },
                { value: "thin", label: "Thin file" },
                { value: "none", label: "No history" },
              ]}
            />
            <Range
              id="workExpYears"
              label="Work experience"
              value={form.workExpYears}
              min={0}
              max={20}
              step={0.5}
              display={years}
              onChange={set("workExpYears")}
              error={errors.workExpYears}
            />
            <Range
              id="householdIncome"
              label="Household income per year"
              value={form.householdIncome}
              min={0}
              max={200000}
              step={1000}
              display={usd}
              input={{ min: 0, max: 10000000 }}
              onChange={set("householdIncome")}
              hint="Enter 0 if there is none."
              error={errors.householdIncome}
            />
          </div>

        </section>

        <section
          className={`card result sticky-col${stale ? " is-stale-card" : ""}`}
          aria-label="Decision result"
          ref={resultRef}
          tabIndex={0}
        >
          {stale && (
            <p className="stale-note">
              Fix the highlighted field and the decision will update. Showing the last valid result.
            </p>
          )}
          {shown ? (
            <DecisionView
              result={shown}
              baseline={activePreset === baselineId ? null : baseline}
              baselineName={baselineScenario?.name}
              thresholds={thresholds}
              stale={stale}
              timing={timing}
              onTryAmount={tryAmount}
              headingRef={headingRef}
            />
          ) : (
            <p className="empty">Fix the highlighted field to see a decision.</p>
          )}
        </section>
      </div>

      {showBar && shown && (
        <div className="result-bar">
          <span className={`chip-dot ${OUTCOME_DOT[shown.decision]}`} aria-hidden="true" />
          <span className="result-bar-text">
            {outcomeWord}
            {shown.score != null ? `, ${shown.score.toFixed(1)}` : ""}
          </span>
          <button type="button" className="btn btn-secondary" onClick={jumpToResult}>
            View decision
          </button>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>
    </>
  );
}
