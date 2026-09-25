import { useEffect, useRef, useState } from "react";
import { OutcomeBadge } from "./Icons";
import Pipeline from "./Pipeline";

const usd = (n) => `$${Number(n).toLocaleString("en-US")}`;

export function outcomeSentence(result, thresholds) {
  if (result.decision === "APPROVED") {
    const p = result.pricing;
    return `Band ${p.band} (${p.label}) at ${p.apr}% APR${result.partner ? `, routed to ${result.partner.name}` : ""}.`;
  }
  if (result.stage === "eligibility") {
    const n = result.reasons.length;
    return `Failed ${n} eligibility rule${n === 1 ? "" : "s"}, so it was never scored.`;
  }
  if (result.decision === "REVIEW") {
    return result.unroutable
      ? "Approved on score, but no lending partner covers this destination, so a person has to place it."
      : `Score is between the review line (${thresholds.reviewAt}) and the approval line (${thresholds.approveAt}), so a credit analyst decides.`;
  }
  return `Score is below the review line of ${thresholds.reviewAt}.`;
}

// Plain-language summary for the screen reader status region.
export function announce(result, thresholds) {
  const label = { APPROVED: "Approved", REVIEW: "Sent to review", DECLINED: "Declined" }[result.decision];
  const score = result.score != null ? ` Score ${result.score} out of 100.` : "";
  return `Decision: ${label}.${score} ${outcomeSentence(result, thresholds)}`;
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Counts from the previous value to the new one so a change reads as movement.
function useAnimatedNumber(target, ms = 450) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target == null) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    const start = from.current == null ? target : from.current;
    if (reducedMotion() || start === target) {
      from.current = target;
      setShown(target);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(start + (target - start) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return shown;
}

function Delta({ value, label, vs, whole = false }) {
  if (value == null || Math.abs(value) < (whole ? 0.5 : 0.05)) return null;
  const up = value > 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`} title={label}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span> {Math.abs(value).toFixed(whole ? 0 : 1)}
      {vs && <span className="delta-vs"> vs {vs}</span>}
    </span>
  );
}

const r1 = (n) => Math.round(n * 10) / 10;

export default function DecisionView({ result, baseline, baselineName, thresholds, stale, timing, onTryAmount, headingRef }) {
  const [focus, setFocus] = useState(null);
  // Engine timings differ between the server render and the browser, so the
  // one trace line that prints a timing waits until after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [open, setOpen] = useState(false);
  const traceRef = useRef(null);
  const shownScore = useAnimatedNumber(result.score);

  function pick(step) {
    const next = activeFocus === step ? null : step;
    setFocus(next);
    if (next) {
      setOpen(true);
      requestAnimationFrame(() => {
        const row = traceRef.current?.querySelector(`[data-step="${next}"]`);
        (row || traceRef.current)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
      });
    }
  }

  const baseScore = baseline && baseline.score != null && result.score != null ? baseline.score : null;
  const basePoints = {};
  if (baseline?.breakdown && result.breakdown) baseline.breakdown.forEach((b) => (basePoints[b.factor] = r1(b.points)));
  // A highlight only applies while the current result has rows for that step.
  const activeFocus = focus && result.trace.some((t) => t.step === focus) ? focus : null;
  const vsLabel = baselineName ? `the ${baselineName} sample` : "the sample";

  return (
    <div className="decision">
      <div className="decision-head">
        <h2 className="card-title" tabIndex={-1} ref={headingRef}>
          Decision
        </h2>
        <span className={`live-chip${stale ? " is-paused" : ""}`}>
          <span className="live-dot" aria-hidden="true" /> {stale ? "Paused" : "Live"}
        </span>
      </div>

      <Pipeline result={result} onPick={pick} active={activeFocus} />

      <div className="outcome">
        <OutcomeBadge decision={result.decision} />
        {result.score != null && (
          <p className="score-inline">
            <span className="score-num">{shownScore == null ? "" : shownScore.toFixed(1)}</span>
            <span className="score-of">/ 100</span>
            <Delta
              value={baseScore == null ? null : result.score - baseScore}
              label={`Change from ${vsLabel}`}
              vs={baselineName}
            />
          </p>
        )}
      </div>
      <p className="outcome-note">{outcomeSentence(result, thresholds)}</p>

      {result.score != null && (
        <>
          <Gauge score={result.score} {...thresholds} />
          <ul className="factors" aria-label="Score by factor">
            {result.breakdown.map((b) => (
              <li className="factor" key={b.factor}>
                <span className="factor-name">{b.factor}</span>
                <span className="factor-bar" aria-hidden="true">
                  <span className="factor-fill" style={{ width: `${b.weight ? (b.points / b.weight) * 100 : 0}%` }} />
                </span>
                <span className="factor-pts">
                  <b>{b.points.toFixed(1)}</b> / {b.weight}
                  <Delta
                    value={basePoints[b.factor] == null ? null : r1(b.points) - basePoints[b.factor]}
                    label={`Change from ${vsLabel}, rounded to whole points`}
                    whole
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(result.pricing || result.partner) && (
        <dl className="facts">
          {result.pricing && (
            <div>
              <dt>{result.decision === "APPROVED" ? "Pricing" : "Provisional pricing"}</dt>
              <dd>
                {result.pricing.apr}% APR
                <small>
                  Band {result.pricing.band}, {result.pricing.label}
                </small>
              </dd>
            </div>
          )}
          <div>
            <dt>Lending partner</dt>
            <dd>
              {result.partner ? result.partner.name : "None found"}
              <small>{result.partner ? "Matched on destination" : "Flagged for operations"}</small>
            </dd>
          </div>
        </dl>
      )}

      {result.reasons?.length > 0 && (
        <>
          <h3 className="section-title">Why it was declined</h3>
          <ul className="reasons">
            {result.reasons.map((r) => (
              <li key={r.ruleId || r.rule}>
                <strong>{r.rule}</strong>
                {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <Suggestion s={result.suggestion} onTryAmount={onTryAmount} />

      <details className="trace-wrap" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} ref={traceRef}>
        <summary>
          <span>
            Decision trace, {result.trace.length} steps
            {activeFocus && <span className="trace-filter">, {activeFocus} steps highlighted</span>}
          </span>
        </summary>
        <ol className="trace">
          {result.trace.map((t, i) => (
            <li key={i} data-step={t.step} className={activeFocus && t.step === activeFocus ? "is-focus" : undefined}>
              <span className={`step step-${t.step}`}>{t.step}</span>
              <TraceDetail text={t.step === "complete" && !mounted ? "Decision rendered" : t.detail} />
            </li>
          ))}
        </ol>
      </details>

      {timing && <p className="timing">{timing}</p>}
    </div>
  );
}

function Gauge({ score, reviewAt, approveAt }) {
  const clamp = (n) => Math.max(0, Math.min(100, n));
  return (
    <div className="gauge">
      <p className="sr-only">
        Score {score} out of 100. Declined below {reviewAt}, review from {reviewAt}, approved from {approveAt}.
      </p>
      <div className="gauge-track" aria-hidden="true">
        <span className="zone-decline" style={{ width: `${clamp(reviewAt)}%` }} />
        <span className="zone-review" style={{ width: `${clamp(approveAt - reviewAt)}%` }} />
        <span className="zone-approve" style={{ width: `${clamp(100 - approveAt)}%` }} />
        <span className="gauge-marker" style={{ left: `${clamp(score)}%` }} />
      </div>
      <ul className="gauge-legend" aria-hidden="true">
        <li><i className="zone-decline" /> Decline below {reviewAt}</li>
        <li><i className="zone-review" /> Review from {reviewAt}</li>
        <li><i className="zone-approve" /> Approve from {approveAt}</li>
      </ul>
    </div>
  );
}

function TraceDetail({ text }) {
  const m = /^(PASS|FAIL): (.*)$/.exec(text);
  if (m) {
    return (
      <span>
        <span className={m[1] === "PASS" ? "pass" : "fail"}>{m[1] === "PASS" ? "Pass" : "Fail"}</span>
        {": "}
        {m[2]}
      </span>
    );
  }
  const skip = /^Rule skipped \(disabled\): (.*)$/.exec(text);
  if (skip) {
    return (
      <span>
        <span className="skip">Skipped</span>, rule off: {skip[1]}
      </span>
    );
  }
  return <span>{text}</span>;
}

function Suggestion({ s, onTryAmount }) {
  if (!s) return null;
  const head = <h3 id="suggest-h">What would change this</h3>;
  if (s.kind === "eligibility") {
    return (
      <section className="suggest" aria-labelledby="suggest-h">
        {head}
        <ul>
          {s.fixes.map((f) => (
            <li key={f.ruleId}>{f.hint}</li>
          ))}
        </ul>
        <p className="note">{s.note}</p>
      </section>
    );
  }
  if (s.kind === "routing") {
    return (
      <section className="suggest" aria-labelledby="suggest-h">
        {head}
        <p>{s.hint}</p>
      </section>
    );
  }
  if (s.kind === "amount") {
    return (
      <section className="suggest" aria-labelledby="suggest-h">
        {head}
        <p>
          Borrowing <strong>{usd(s.amount)}</strong> instead would score {s.score} and be approved in band {s.band} at{" "}
          {s.apr}% APR, with every other input the same.
        </p>
        {onTryAmount && (
          <button type="button" className="btn btn-secondary" onClick={() => onTryAmount(s.amount)}>
            Set the loan to {usd(s.amount)}
          </button>
        )}
        <p className="note">The largest round amount that gets approved, found by re-running the engine.</p>
      </section>
    );
  }
  return (
    <section className="suggest" aria-labelledby="suggest-h">
      {head}
      <p>
        Even at {usd(s.floor)} this would not be approved. It needs {s.pointsNeeded} more points, and the biggest gap
        is {s.factor?.toLowerCase()} ({s.points} of {s.weight}).
      </p>
    </section>
  );
}
