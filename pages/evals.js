import { useMemo } from "react";
import Link from "next/link";
import { usePolicy } from "../lib/usePolicy";
import { runPolicyTests, label } from "../lib/impact";
import { CheckIcon, AlertIcon, CrossIcon } from "../components/Icons";

const REPO = "https://github.com/subhasishgoswami02/decision-studio";

const INVARIANTS = [
  "The same application always gets the same decision, score and trace.",
  "Scores stay between 0 and 100 and equal the sum of their factors.",
  "More household income, better credit, a better school or a smaller loan never lowers the score.",
  "Switching an eligibility rule off never makes an outcome worse.",
  "An approval always carries a price and a partner; a knockout always names the rule that failed.",
  "A higher score never gets a higher rate.",
  "Every rule that is on appears exactly once in the trace.",
  "The API rejects malformed applications and rule sets with a 400, never a crash.",
];

export default function PolicyTests() {
  const policy = usePolicy();
  const tests = useMemo(() => runPolicyTests(policy.config), [policy.config]);
  const edited = policy.source === "custom";

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Evals for a credit policy</p>
        <h1>Policy tests</h1>
        <p className="lede">
          {tests.total} test applicants, each with the decision the default policy should give and the reason, worked
          out by hand. The same cases run in CI on every change, so code that shifts a decision fails the build. Edit a
          rule in the <Link href="/rules">rules console</Link> and this page shows who it would affect.
        </p>
      </header>

      {policy.notice && <p className="notice" role="status">{policy.notice}</p>}

      <dl className="tiles">
        <div className="tile">
          <dt>{edited ? "Unchanged under your rules" : "Matching the default policy"}</dt>
          <dd>
            {tests.matched} <small>of {tests.total}</small>
          </dd>
        </div>
        <div className="tile">
          <dt>Decided differently</dt>
          <dd>
            {tests.changed} <small>{tests.changed ? "see highlighted rows" : "none"}</small>
          </dd>
        </div>
        <div className="tile">
          <dt>Approvals</dt>
          <dd>
            {tests.approvalsActual}{" "}
            <small>{edited ? `vs ${tests.approvalsExpected} by default` : `of ${tests.total}`}</small>
          </dd>
        </div>
      </dl>

      <section className="card" aria-labelledby="cases-h">
        <h2 className="card-title" id="cases-h">
          Test applicants
        </h2>
        <p className="card-sub" style={{ marginBottom: 12 }}>
          Active policy: {edited ? `edited, ${policy.changes} setting${policy.changes === 1 ? "" : "s"} changed` : "default"}.
        </p>
        <table className="tests-table">
          <caption className="sr-only">Each test applicant, the expected decision, the decision under the active policy, and whether they match</caption>
          <thead>
            <tr>
              <th scope="col">Applicant</th>
              <th scope="col">Expected</th>
              <th scope="col">{edited ? "Your rules" : "Engine"}</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.rows.map((r) => (
              <tr key={r.scenario.id} className={r.match ? undefined : "changed"}>
                <td data-label="Applicant">
                  <strong>{r.scenario.name}</strong>
                  <small>{r.scenario.summary}</small>
                  <small>{r.scenario.why}</small>
                </td>
                <td data-label="Expected">
                  <span className="nowrap">{label(r.expected)}</span>
                </td>
                <td data-label={edited ? "Your rules" : "Engine"}>
                  <span className="nowrap">{label(r.actual)}</span>
                  {r.actual.score != null && <small>Score {r.actual.score}</small>}
                </td>
                <td data-label="Result">
                  <Status row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="inv-h">
        <h2 className="card-title" id="inv-h">
          Properties checked in CI
        </h2>
        <p className="card-sub">
          Beyond the fixed cases, the test suite generates hundreds of random applicants and checks rules that must hold
          for every one of them. These run in the build, not on this page.
        </p>
        <ul className="invariants">
          {INVARIANTS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="link-row">
          <a className="btn btn-secondary" href={`${REPO}/tree/main/tests`}>
            Read the tests
          </a>
          <a className="btn btn-quiet" href={`${REPO}/actions`}>
            CI runs
          </a>
        </div>
      </section>
    </>
  );
}

function Status({ row }) {
  if (row.match) {
    return (
      <span className="status match">
        <CheckIcon /> Match
      </span>
    );
  }
  const text = { worse: "Worse outcome", better: "Better outcome", same: "Changed" }[row.direction];
  const Icon = row.direction === "worse" ? CrossIcon : AlertIcon;
  return (
    <span className={`status ${row.direction}`}>
      <Icon /> {text}
    </span>
  );
}
