import { useEffect, useRef, useState } from "react";

// Form controls for the Apply page. All are native inputs underneath
// (radios, range, checkbox, number), so keyboard and screen reader support
// comes from the browser; the styling lives in styles/globals.css.

export function Segmented({ name, legend, value, options, onChange, compact = false }) {
  return (
    <fieldset className={`seg${compact ? " seg-compact" : ""}`}>
      <legend className="ctl-label">{legend}</legend>
      <div className="seg-track">
        {options.map((o) => (
          <label className="seg-opt" key={o.value}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A slider with a live value readout. When `input` is set, a number box sits
// beside it for exact values (money fields), and the slider follows it.
export function Range({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onBlur,
  input,
  band,
  bandLabel,
  hint,
  hintTone,
  error,
}) {
  // Typed amounts are held as a draft and committed on Enter, on blur, or
  // after a short pause, so typing "25000" never flashes "2" as an error.
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v) => {
    clearTimeout(timer.current);
    setDraft(null);
    if (v !== value) onChange(v);
  };
  const shownValue = draft ?? value;
  const n = Number(shownValue);
  const valid = shownValue !== "" && Number.isFinite(n);
  const clamped = valid ? Math.min(max, Math.max(min, n)) : min;
  const pct = ((clamped - min) / (max - min)) * 100;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  // The lendable range is drawn as a bracket under the track, with its two
  // limits labelled, so the slider itself stays a clean, single control.
  const at = (v) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const bandL = band ? at(band[0]) : 0;
  const bandR = band ? at(band[1]) : 0;
  const bandStyle = band ? { left: `${bandL}%`, width: `${Math.max(0, bandR - bandL)}%` } : null;
  const edge = (p) => (p < 6 ? "is-start" : p > 94 ? "is-end" : "");
  const showBandLabels = band && bandLabel && bandR - bandL >= 14;

  return (
    <div className="ctl">
      <div className="ctl-head">
        <label className="ctl-label" htmlFor={input ? `${id}-range` : id}>
          {label}
        </label>
        {!input && (
          <output className="ctl-value" htmlFor={id} aria-hidden="true">
            {valid ? display(n) : "Not set"}
          </output>
        )}
      </div>
      <div className={`range-row${input ? " with-input" : ""}`}>
        <div className={`range-wrap${band ? " has-band" : ""}`} style={{ "--pct": `${pct}%` }}>
          {bandStyle && <span className="range-band" style={bandStyle} aria-hidden="true" />}
          {showBandLabels && (
            <>
              <span className={`range-band-label ${edge(bandL)}`} style={{ left: `${bandL}%` }} aria-hidden="true">
                {bandLabel(band[0])}
              </span>
              <span className={`range-band-label ${edge(bandR)}`} style={{ left: `${bandR}%` }} aria-hidden="true">
                {bandLabel(band[1])}
              </span>
            </>
          )}
          <input
            id={input ? `${id}-range` : id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={clamped}
            onChange={(e) => commit(e.target.value)}
            aria-valuetext={valid ? display(n) : "Not set"}
            aria-describedby={describedBy}
          />
        </div>
        {input && (
          <div className="money">
            <span aria-hidden="true">$</span>
            <input
              id={id}
              name={id}
              type="number"
              inputMode="numeric"
              min={input.min}
              max={input.max}
              step={step}
              value={shownValue}
              onChange={(e) => {
                const v = e.target.value;
                setDraft(v);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => commit(v), 700);
              }}
              onBlur={() => {
                if (draft !== null) commit(draft);
                if (onBlur) onBlur();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft !== null) {
                  e.preventDefault();
                  commit(draft);
                }
              }}
              aria-label={`${label}, exact amount`}
              aria-invalid={error && draft === null ? "true" : undefined}
              aria-describedby={describedBy}
            />
          </div>
        )}
      </div>
      {hint && (
        <p className={`hint${hintTone === "warn" ? " hint-warn" : ""}`} id={`${id}-hint`}>
          {hintTone === "warn" && (
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M10 3.5 18 17H2z" strokeLinejoin="round" />
              <path d="M10 8.5v3.6M10 14.4v.1" />
            </svg>
          )}
          <span>{hint}</span>
        </p>
      )}
      {error && draft === null && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

// A slider over a fixed list of choices (e.g. graduation timing).
export function Steps({ id, label, value, steps, onChange }) {
  const idx = Math.max(0, steps.findIndex((s) => s.value === value));
  const pct = (idx / (steps.length - 1)) * 100;
  return (
    <div className="ctl">
      <div className="ctl-head">
        <label className="ctl-label" htmlFor={id}>
          {label}
        </label>
        <output className="ctl-value" htmlFor={id} aria-hidden="true">
          {steps[idx].label}
        </output>
      </div>
      <div className="range-wrap" style={{ "--pct": `${pct}%` }}>
        <input
          id={id}
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={idx}
          onChange={(e) => onChange(steps[Number(e.target.value)].value)}
          aria-valuetext={steps[idx].label}
        />
      </div>
    </div>
  );
}

export function Toggle({ id, label, checked, onChange }) {
  return (
    <label className="switch toggle-row" htmlFor={id}>
      <span className="ctl-label">{label}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
    </label>
  );
}
