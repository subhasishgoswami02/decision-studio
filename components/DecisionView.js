import { OutcomeBadge } from "./Icons";

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

export default function DecisionView({ result, thresholds, roundTripMs, onTryAmount, headingRef }) {
  return (
    <div>
      <h2 className="card-title" tabIndex={-1} ref={headingRef}>
        Decision
      </h2>
      <div className="outcome">
        <OutcomeBadge decision={result.decision} />
      </div>
      <p className="outcome-note">{outcomeSentence(result, thresholds)}</p>
      <p className="timing">
        Engine time {result.totalMs < 1 ? "under 1" : result.totalMs} ms
        {roundTripMs != null ? `, ${Math.round(roundTripMs)} ms round trip` : ""}
      </p>

      {result.score != null && (
        <>
          <h3 className="section-title">Score</h3>
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
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(result.pricing || result.partner) && (
        <>
          <h3 className="section-title">Offer</h3>
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
        </>
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

      <details className="trace-wrap" open>
        <summary>Decision trace, {result.trace.length} steps</summary>
        <ol className="trace">
          {result.trace.map((t, i) => (
            <li key={i}>
              <span className={`step step-${t.step}`}>{t.step}</span>
              <TraceDetail text={t.detail} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Gauge({ score, reviewAt, approveAt }) {
  const clamp = (n) => Math.max(0, Math.min(100, n));
  return (
    <div className="gauge">
      <p className="gauge-head">
        <span className="gauge-score">{score}</span>
        <span className="gauge-of">out of 100</span>
      </p>
      <p className="sr-only">
        Declined below {reviewAt}, review from {reviewAt}, approved from {approveAt}.
      </p>
      <div className="gauge-track" aria-hidden="true">
        <span className="zone-decline" style={{ width: `${clamp(reviewAt)}%` }} />
        <span className="zone-review" style={{ width: `${clamp(approveAt - reviewAt)}%` }} />
        <span className="zone-approve" style={{ width: `${clamp(100 - approveAt)}%` }} />
        <span className="gauge-marker" style={{ left: `${clamp(score)}%` }} />
      </div>
      <div className="gauge-scale" aria-hidden="true">
        <span>0</span>
        <span>100</span>
      </div>
      <ul className="gauge-legend" aria-hidden="true">
        <li><i className="zone-decline" /> Declined below {reviewAt}</li>
        <li><i className="zone-review" /> Review from {reviewAt}</li>
        <li><i className="zone-approve" /> Approved from {approveAt}</li>
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
  if (s.kind === "eligibility") {
    return (
      <section className="suggest" aria-labelledby="suggest-h">
        <h3 id="suggest-h">What would change this</h3>
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
        <h3 id="suggest-h">What would change this</h3>
        <p>{s.hint}</p>
      </section>
    );
  }
  if (s.kind === "amount") {
    return (
      <section className="suggest" aria-labelledby="suggest-h">
        <h3 id="suggest-h">What would change this</h3>
        <p>
          Borrowing <strong>{usd(s.amount)}</strong> instead would score {s.score} and be approved in band {s.band} at{" "}
          {s.apr}% APR, with every other input the same. It is the largest round amount that gets approved.
        </p>
        {onTryAmount && (
          <button type="button" className="btn btn-secondary" onClick={() => onTryAmount(s.amount)}>
            Try {usd(s.amount)}
          </button>
        )}
        <p className="note">Checked by re-running the engine, not estimated.</p>
      </section>
    );
  }
  return (
    <section className="suggest" aria-labelledby="suggest-h">
      <h3 id="suggest-h">What would change this</h3>
      <p>
        Even at {usd(s.floor)} this would not be approved. It needs {s.pointsNeeded} more points, and the
        biggest gap is {s.factor?.toLowerCase()} ({s.points} of {s.weight}).
      </p>
    </section>
  );
}
