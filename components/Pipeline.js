// The five decision stages as a live stepper. Each node shows what happened
// at that stage for the current result, and jumps to its lines in the trace.

const Icon = ({ kind }) => {
  const p = { viewBox: "0 0 20 20", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };
  if (kind === "ok") return <svg {...p}><path d="M5 10.5l3.2 3.2L15 7" /></svg>;
  if (kind === "fail") return <svg {...p}><path d="M6 6l8 8M14 6l-8 8" /></svg>;
  if (kind === "warn") return <svg {...p}><path d="M10 5v6" /><path d="M10 14.6v.1" /></svg>;
  return <svg {...p}><path d="M6 10h8" /></svg>;
};

const WORD = { ok: "done", fail: "failed", warn: "needs a person" };

export function stagesOf(result) {
  const elig = result.trace.filter((t) => t.step === "eligibility");
  const checked = elig.filter((t) => !t.detail.startsWith("Rule skipped"));
  const failed = checked.filter((t) => t.detail.startsWith("FAIL"));
  const scored = result.score != null;
  const approvedOnScore = result.decision === "APPROVED" || result.unroutable;

  return [
    {
      key: "eligibility",
      short: "Rules",
      label: "Eligibility",
      state: failed.length ? "fail" : "ok",
      caption: failed.length ? `${failed.length} of ${checked.length} failed` : `${checked.length} of ${checked.length} passed`,
    },
    {
      key: "scorecard",
      short: "Score",
      label: "Scorecard",
      state: scored ? "ok" : "idle",
      caption: scored ? `${result.score.toFixed(1)} / 100` : "Not reached",
    },
    {
      key: "decision",
      short: "Decide",
      label: "Threshold",
      state: !scored ? "idle" : approvedOnScore ? "ok" : result.decision === "REVIEW" ? "warn" : "fail",
      caption: !scored ? "Not reached" : approvedOnScore ? "Approve" : result.decision === "REVIEW" ? "Review" : "Decline",
    },
    {
      key: "pricing",
      short: "Price",
      label: "Pricing",
      state: result.pricing ? "ok" : "idle",
      caption: result.pricing ? `Band ${result.pricing.band}, ${result.pricing.apr}%` : "Not reached",
    },
    {
      key: "routing",
      short: "Route",
      label: "Routing",
      state: result.partner ? "ok" : result.unroutable ? "fail" : "idle",
      caption: result.partner ? result.partner.name : result.unroutable ? "No partner" : "Not reached",
    },
  ];
}

export default function Pipeline({ result, onPick, active }) {
  const stages = stagesOf(result);
  return (
    <ol className="pipe" aria-label="Decision pipeline">
      {stages.map((s, i) => (
        <li key={s.key} className={`pipe-step is-${s.state}`} style={{ "--i": i }}>
          <button
            type="button"
            className="pipe-btn"
            onClick={() => s.state !== "idle" && onPick(s.key)}
            aria-pressed={s.state === "idle" ? undefined : active === s.key}
            aria-disabled={s.state === "idle" ? "true" : undefined}
            aria-label={
              s.state === "idle"
                ? `${s.label}: not reached.`
                : `${s.label}: ${s.caption}, ${WORD[s.state]}. Show these steps in the trace.`
            }
          >
            <span className="pipe-dot">
              <Icon kind={s.state} />
            </span>
            <span className="pipe-label">
              <span className="pipe-long">{s.label}</span>
              <span className="pipe-short" aria-hidden="true">{s.short}</span>
            </span>
            <span className="pipe-caption">{s.caption}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
