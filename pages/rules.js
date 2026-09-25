import { useMemo, useState } from "react";
import Link from "next/link";
import { usePolicy } from "../lib/usePolicy";
import { configSchema } from "../lib/validate";
import { runPolicyTests } from "../lib/impact";

const WEIGHT_LABELS = {
  schoolTier: "School tier",
  fieldOfStudy: "Field of study",
  creditHistory: "Credit history",
  incomeCoverage: "Income coverage",
  workExperience: "Work experience",
  countryRisk: "Country risk",
};
const DESTINATIONS = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
];

export default function RulesConsole() {
  const policy = usePolicy();
  const { config } = policy;
  const [drafts, setDrafts] = useState({});
  const [errs, setErrs] = useState({});
  const [saved, setSaved] = useState("");

  const tests = useMemo(() => runPolicyTests(config), [config]);
  const edited = policy.source === "custom";

  function commit(key, next, message = "Saved. The next decision uses this.") {
    const ok = configSchema.safeParse(next);
    if (!ok.success) {
      setErrs((e) => ({ ...e, [key]: `${ok.error.issues[0].message}. Not saved.` }));
      setSaved("Not saved. Fix the highlighted field.");
      return false;
    }
    setErrs((e) => {
      const out = { ...e, [key]: undefined };
      // Other fields still holding a rejected value: the conflict may be gone
      // now, so point to the fix instead of repeating the old error.
      for (const k of Object.keys(drafts)) {
        if (k !== key && out[k]) out[k] = "Not saved yet. Press Enter in this field to try it again.";
      }
      return out;
    });
    policy.update(next);
    setSaved(message);
    return true;
  }

  // Numeric inputs keep the raw text while it is typed and save only when the
  // field is left or Enter is pressed, so a half-typed "8" on the way to "80"
  // never becomes the live policy.
  function numberInput(key, value, { min, max, step = 1, int = true, label }, apply) {
    const raw = drafts[key] ?? String(value);
    const keepNote = ` Not saved; the rule still uses ${fmt(value)}.`;
    const clearDraft = () =>
      setDrafts((d) => {
        const { [key]: _drop, ...rest } = d;
        return rest;
      });
    const onChange = (e) => {
      const text = e.target.value;
      setDrafts((d) => ({ ...d, [key]: text }));
      if (errs[key]) setErrs((x) => ({ ...x, [key]: undefined }));
    };
    const save = () => {
      if (drafts[key] === undefined) return;
      const text = drafts[key].trim();
      const n = text === "" ? NaN : Number(text);
      const fail = (msg) => {
        setErrs((x) => ({ ...x, [key]: msg + "." + keepNote }));
        setSaved("Not saved. Fix the highlighted field.");
      };
      if (!Number.isFinite(n)) return fail(`Enter ${label} as a number`);
      if (int && !Number.isInteger(n)) return fail("Use a whole number");
      if (n < min || n > max) return fail(`Use a value from ${fmt(min)} to ${fmt(max)}`);
      if (n === value) return clearDraft();
      const next = structuredClone(config);
      apply(next, n);
      if (commit(key, next)) clearDraft();
      else setErrs((x) => ({ ...x, [key]: x[key].replace(/ Not saved\.$/, "") + keepNote }));
    };
    return (
      <>
        <input
          id={key}
          type="number"
          inputMode={int ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={step}
          value={raw}
          onChange={onChange}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          aria-invalid={errs[key] ? "true" : undefined}
          aria-describedby={errs[key] ? `${key}-error` : undefined}
        />
        {errs[key] && (
          <p className="field-error" id={`${key}-error`}>
            {errs[key]}
          </p>
        )}
      </>
    );
  }

  const ruleIndex = (id) => config.eligibilityRules.findIndex((r) => r.id === id);

  function toggleRule(id) {
    const next = structuredClone(config);
    const r = next.eligibilityRules[ruleIndex(id)];
    r.enabled = !r.enabled;
    commit(`rule-${id}`, next, `${r.name} switched ${r.enabled ? "on" : "off"}.`);
  }

  function toggleDestination(code) {
    const next = structuredClone(config);
    const r = next.eligibilityRules[ruleIndex("supported-destination")];
    const set = new Set(r.params.destinations);
    set.has(code) ? set.delete(code) : set.add(code);
    r.params.destinations = DESTINATIONS.map(([c]) => c).filter((c) => set.has(c));
    commit("destinations", next);
  }

  function setTier(value) {
    const next = structuredClone(config);
    next.eligibilityRules[ruleIndex("school-tier")].params.maxTier = Number(value);
    commit("maxTier", next);
  }

  function reset() {
    if (!edited) {
      setSaved("Already using the default policy.");
      return;
    }
    policy.reset();
    setDrafts({});
    setErrs({});
    setSaved("Reset to the default policy.");
  }

  return (
    <>
      <div className="console-head">
        <header className="page-head">
          <p className="eyebrow">Configuration, not code</p>
          <h1>Rules console</h1>
          <p className="lede">
            Change a rule and the next decision uses it. No deploy. Number fields save when you press Enter or
            leave the field. Edits stay in this browser only, so nobody else sees them.
          </p>
        </header>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={reset}
          aria-disabled={edited ? undefined : "true"}
        >
          Reset to defaults
        </button>
      </div>

      {policy.notice && <p className="notice" role="status">{policy.notice}</p>}
      {policy.saveFailed && (
        <p className="notice" role="alert">
          This browser blocked saving, so these edits will not reach the Apply page. Allow site data and try again.
        </p>
      )}

      <section className={`impact${tests.changed ? " changed" : ""}`} aria-labelledby="impact-h">
        <div role="status" aria-live="polite">
          <h2 id="impact-h" className="sr-only">
            Impact on the policy tests
          </h2>
          {tests.changed === 0 ? (
            <p>
              <strong>{tests.matched} of {tests.total}</strong> test applicants get their expected decision
              {edited ? " under your edited rules." : "."}
            </p>
          ) : (
            <p>
              <strong>
                {tests.changed} of {tests.total}
              </strong>{" "}
              test applicants would be decided differently. Approvals go from {tests.approvalsExpected} to{" "}
              {tests.approvalsActual}.
            </p>
          )}
        </div>
        <Link href="/evals" className="btn btn-quiet">
          {tests.changed ? "Review the changes" : "See the policy tests"}
        </Link>
      </section>

      <p className="status-line" role="status" aria-live="polite">
        {saved}
      </p>

      <div className="console-grid">
        <div>
          <section className="card" aria-labelledby="elig-h">
            <h2 className="card-title" id="elig-h">
              Eligibility rules
            </h2>
            <p className="card-sub">Knockouts run first. Failing any rule that is on declines the application before scoring.</p>

            {config.eligibilityRules.map((r) => (
              <div className="rule" key={r.id}>
                <div className="rule-head">
                  <div>
                    <p className="rule-name" id={`rule-${r.id}-name`}>
                      {r.name}
                    </p>
                    <p className="rule-desc" id={`rule-${r.id}-desc`}>
                      {r.description}
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={r.enabled}
                      onChange={() => toggleRule(r.id)}
                      aria-labelledby={`rule-${r.id}-name`}
                      aria-describedby={`rule-${r.id}-desc`}
                    />
                    <span className="track" aria-hidden="true" />
                    <span className="state" aria-hidden="true">
                      {r.enabled ? "On" : "Off"}
                    </span>
                  </label>
                </div>

                {r.id === "amount-range" && (
                  <div className="params">
                    <div className="field">
                      <label htmlFor="minAmount">Floor, $</label>
                      {numberInput("minAmount", r.params.minAmount, { min: 1000, max: 500000, step: 1000, label: "a floor" }, (c, n) => {
                        c.eligibilityRules[ruleIndex("amount-range")].params.minAmount = n;
                      })}
                    </div>
                    <div className="field">
                      <label htmlFor="maxAmount">Ceiling, $</label>
                      {numberInput("maxAmount", r.params.maxAmount, { min: 1000, max: 500000, step: 1000, label: "a ceiling" }, (c, n) => {
                        c.eligibilityRules[ruleIndex("amount-range")].params.maxAmount = n;
                      })}
                    </div>
                  </div>
                )}

                {r.id === "supported-destination" && (
                  <fieldset className="params">
                    <legend className="sr-only">Accepted destinations</legend>
                    {DESTINATIONS.map(([code, name]) => (
                      <label className="check" key={code}>
                        <input
                          type="checkbox"
                          checked={r.params.destinations.includes(code)}
                          onChange={() => toggleDestination(code)}
                        />
                        {name}
                      </label>
                    ))}
                  </fieldset>
                )}

                {r.id === "enrollment-window" && (
                  <div className="params">
                    <div className="field">
                      <label htmlFor="maxMonths">Window, months</label>
                      {numberInput("maxMonths", r.params.maxMonthsToGraduation, { min: 1, max: 120, label: "a window" }, (c, n) => {
                        c.eligibilityRules[ruleIndex("enrollment-window")].params.maxMonthsToGraduation = n;
                      })}
                    </div>
                  </div>
                )}

                {r.id === "school-tier" && (
                  <div className="params">
                    <div className="field">
                      <label htmlFor="maxTier">Lowest tier accepted</label>
                      <select id="maxTier" value={String(r.params.maxTier)} onChange={(e) => setTier(e.target.value)}>
                        <option value="1">Tier 1 only</option>
                        <option value="2">Tier 2 or better</option>
                        <option value="3">Tier 3 or better</option>
                        <option value="4">Any, including unranked</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="card" aria-labelledby="thr-h">
            <h2 className="card-title" id="thr-h">
              Decision thresholds
            </h2>
            <div className="params">
              <div className="field">
                <label htmlFor="approveAt">Approve at score</label>
                {numberInput("approveAt", config.decisionThresholds.approveAt, { min: 0, max: 100, int: false, step: 0.1, label: "a score" }, (c, n) => {
                  c.decisionThresholds.approveAt = n;
                })}
              </div>
              <div className="field">
                <label htmlFor="reviewAt">Review from score</label>
                {numberInput("reviewAt", config.decisionThresholds.reviewAt, { min: 0, max: 100, int: false, step: 0.1, label: "a score" }, (c, n) => {
                  c.decisionThresholds.reviewAt = n;
                })}
              </div>
            </div>
            <p className="thresholds-explain">
              At or above {config.decisionThresholds.approveAt}: approved. From {config.decisionThresholds.reviewAt} up to
              that: a credit analyst decides. Below {config.decisionThresholds.reviewAt}: declined.
            </p>
          </section>

          <section className="card" aria-labelledby="price-h">
            <h2 className="card-title" id="price-h">
              Pricing bands
            </h2>
            <p className="card-sub">An approved loan gets the best band whose floor its score clears.</p>
            <table className="tier-table">
              <caption className="sr-only">Pricing bands, with the minimum score and APR for each</caption>
              <thead>
                <tr>
                  <th scope="col">Band</th>
                  <th scope="col">Min score</th>
                  <th scope="col">APR, %</th>
                </tr>
              </thead>
              <tbody>
                {config.pricingTiers.map((t, i) => (
                  <tr key={t.band}>
                    <th scope="row">
                      {t.band} <span className="hint">{t.label}</span>
                    </th>
                    <td>
                      <label className="sr-only" htmlFor={`tier-${t.band}-min`}>
                        Band {t.band} minimum score
                      </label>
                      {numberInput(`tier-${t.band}-min`, t.minScore, { min: 0, max: 100, int: false, step: 0.1, label: "a score" }, (c, n) => {
                        c.pricingTiers[i].minScore = n;
                      })}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`tier-${t.band}-apr`}>
                        Band {t.band} APR, percent
                      </label>
                      {numberInput(`tier-${t.band}-apr`, t.apr, { min: 0, max: 36, int: false, step: 0.01, label: "an APR" }, (c, n) => {
                        c.pricingTiers[i].apr = n;
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div>
          <section className="card" aria-labelledby="w-h">
            <h2 className="card-title" id="w-h">
              Scorecard weights
            </h2>
            <p className="card-sub">Fixed in this demo. Each factor scores 0 to 1 and is multiplied by its weight.</p>
            <ul className="weights">
              {Object.entries(config.scorecard.weights).map(([k, w]) => (
                <li className="factor" key={k}>
                  <span className="factor-name">{WEIGHT_LABELS[k] || k}</span>
                  <span className="factor-bar" aria-hidden="true">
                    <span className="factor-fill" style={{ width: `${(w / 25) * 100}%` }} />
                  </span>
                  <span className="factor-pts">
                    <b>{w}</b> pts
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint" style={{ marginTop: 14 }}>
              Country risk keys on citizenship here only to illustrate a scorecard factor. A US lender would need a
              fair-lending review before using anything tied to national origin, which ECOA and Regulation B restrict.
            </p>
          </section>

          <section className="card" aria-labelledby="p-h">
            <h2 className="card-title" id="p-h">
              Partner routing
            </h2>
            <p className="card-sub">
              Approved loans go to the partner that covers the destination. Accept a destination with no partner and
              approvals there go to review instead.
            </p>
            <ul className="partners">
              {config.partnerRouting.map((p) => (
                <li key={p.id}>
                  {p.name}
                  <span>{p.destinations.join(", ")}</span>
                </li>
              ))}
            </ul>
            <p className="hint" style={{ marginTop: 12 }}>
              In production this is where volume caps, forward-flow allocations and partner eligibility overlays live.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}
