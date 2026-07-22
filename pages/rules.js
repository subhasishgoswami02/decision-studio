import { useEffect, useState } from "react";
import { DEFAULT_CONFIG } from "../lib/defaults";

export default function RulesConsole() {
  const [config, setConfig] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem("ds-config");
    setConfig(saved ? JSON.parse(saved) : structuredClone(DEFAULT_CONFIG));
  }, []);

  if (!config) return <p className="muted">Loading configuration...</p>;

  function save(next) {
    setConfig(next);
    localStorage.setItem("ds-config", JSON.stringify(next));
    setSavedAt(new Date().toLocaleTimeString());
  }

  function rollback() {
    localStorage.removeItem("ds-config");
    setConfig(structuredClone(DEFAULT_CONFIG));
    setSavedAt("rolled back to defaults");
  }

  const toggleRule = (id) =>
    save({
      ...config,
      eligibilityRules: config.eligibilityRules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      ),
    });

  const setRuleParam = (id, key, value) =>
    save({
      ...config,
      eligibilityRules: config.eligibilityRules.map((r) =>
        r.id === id ? { ...r, params: { ...r.params, [key]: Number(value) } } : r
      ),
    });

  const setThreshold = (key, value) =>
    save({
      ...config,
      decisionThresholds: { ...config.decisionThresholds, [key]: Number(value) },
    });

  const setTier = (band, key, value) =>
    save({
      ...config,
      pricingTiers: config.pricingTiers.map((t) =>
        t.band === band ? { ...t, [key]: Number(value) } : t
      ),
    });

  return (
    <div>
      <div className="console-head">
        <div>
          <h1>Rules Console</h1>
          <p className="muted">
            Every change takes effect on the next application, no code deploy
            needed. {savedAt && <strong>Last change: {savedAt}</strong>}
          </p>
        </div>
        <button className="ghost" onClick={rollback}>Rollback to defaults</button>
      </div>

      <section className="card">
        <h2>Eligibility rules</h2>
        {config.eligibilityRules.map((r) => (
          <div className="rule" key={r.id}>
            <label className="switch">
              <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id)} />
              <span className="rule-name">{r.name}</span>
            </label>
            <p className="muted small">{r.description}</p>
            <div className="params">
              {"minAmount" in r.params && (
                <label>Floor ($)
                  <input type="number" value={r.params.minAmount} onChange={(e) => setRuleParam(r.id, "minAmount", e.target.value)} />
                </label>
              )}
              {"maxAmount" in r.params && (
                <label>Ceiling ($)
                  <input type="number" value={r.params.maxAmount} onChange={(e) => setRuleParam(r.id, "maxAmount", e.target.value)} />
                </label>
              )}
              {"maxTier" in r.params && (
                <label>Minimum tier (1 to 4)
                  <input type="number" min="1" max="4" value={r.params.maxTier} onChange={(e) => setRuleParam(r.id, "maxTier", e.target.value)} />
                </label>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Decision thresholds</h2>
        <div className="params">
          <label>Approve at score
            <input type="number" value={config.decisionThresholds.approveAt} onChange={(e) => setThreshold("approveAt", e.target.value)} />
          </label>
          <label>Review at score
            <input type="number" value={config.decisionThresholds.reviewAt} onChange={(e) => setThreshold("reviewAt", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Pricing tiers</h2>
        {config.pricingTiers.map((t) => (
          <div className="params tier" key={t.band}>
            <span className="tier-band">Band {t.band} ({t.label})</span>
            <label>Min score
              <input type="number" value={t.minScore} onChange={(e) => setTier(t.band, "minScore", e.target.value)} />
            </label>
            <label>APR (%)
              <input type="number" step="0.01" value={t.apr} onChange={(e) => setTier(t.band, "apr", e.target.value)} />
            </label>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Partner routing</h2>
        {config.partnerRouting.map((p) => (
          <p key={p.id}><strong>{p.name}</strong>: destinations {p.destinations.join(", ")}</p>
        ))}
        <p className="muted small">
          Routing is destination-based in this demo. In production this is where
          volume caps, forward-flow allocations, and partner eligibility overlays live.
        </p>
      </section>
    </div>
  );
}
