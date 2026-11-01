"use client";

import type { QaRunRecord } from "@shared/qa/run-types";
import { qaMadeJevDecision, qaMadeModelDecision } from "../../../../packages/shared/ui-lib/qa/jev-summary";
import styles from "./qa.module.css";

export function RunReceipt({ run }: { run: QaRunRecord }) {
  const receipt = run.receipt;
  if (!receipt) return <p>QA evidence is not available yet.</p>;
  if (run.state === "running") return <div className={styles.receipt}><div className={styles.receiptHeader}><h2>{receipt.title}</h2><span className="badge badge-muted">Running</span></div><p>QA results are provisional until the run finishes.</p></div>;
  const badge = receipt.status === "passed" ? "badge-success" : receipt.status === "failed" ? "badge-danger" : "badge-warning";
  const media = (file: string) => `/api/qa/runs/${run.id}/media/${encodeURIComponent(file)}`;
  return <div className={styles.receipt}>
    <div className={styles.receiptHeader}><h2>{receipt.title}</h2><span className={`badge ${badge}`}>{receipt.status}</span></div>
    <p>{receipt.stopReason}</p>
    {receipt.status === "passed" && <p>{qaMadeJevDecision(receipt) ? "Jev chose actions; assertions determined the result." : qaMadeModelDecision(receipt) ? "A model chose actions; assertions determined the result." : "Assertion-only verification passed; no model decision was made."}</p>}
    {run.taskAssertions && <p>Generated checks do not click, type or use a model. Loading the preview can still run scripts and send requests. Use an isolated test environment; a pass covers only these checks.</p>}
    <ul className={styles.goals}>{receipt.goals.map(goal => {
      const match = /^goal-(\d+)$/.exec(goal.id);
      const assertion = match ? run.taskAssertions?.goals[Number(match[1]) - 1] : undefined;
      return <li key={goal.id}><strong>{goal.passed ? "Pass" : "Fail"}</strong> · {goal.description}
        {assertion && <p><code>{assertion.selector}</code> {assertion.assertion === "text" ? <>contains <code>{assertion.expected}</code></> : "is visible"}</p>}
        <details><summary>Assertion evidence</summary><pre>{goal.actual}</pre></details></li>;
    })}</ul>
    <p className={styles.usage}>{(receipt.totals.durationMs / 1000).toFixed(1)}s · {receipt.totals.inputTokens.toLocaleString()} input / {receipt.totals.outputTokens.toLocaleString()} output tokens · ${receipt.totals.estimatedCostUsd.toFixed(6)} estimated{receipt.totals.unknownCostCalls > 0 ? ` · ${receipt.totals.unknownCostCalls} calls with unknown cost` : ""}</p>
    <div className={styles.media}>{receipt.artifacts.map(artifact => <figure key={artifact.file}>
      {artifact.kind === "image" ?

        <a href={media(artifact.file)} target="_blank" rel="noreferrer"><img src={media(artifact.file)} alt={`${artifact.phase} screenshot of ${receipt.title}`} /></a> :
        <video controls preload="metadata" src={media(artifact.file)} aria-label="QA recording" />}
      <figcaption>{artifact.phase === "failure" ? "Failure frame" : artifact.kind === "video" ? "Recording" : artifact.phase === "before" ? "Before actions" : "After actions"}</figcaption>
    </figure>)}</div>
    {receipt.errors.length > 0 && <p role="alert" className="tone-panel tone-panel--warning">{receipt.errors.join(" · ")}</p>}
    <details><summary>Decision trace · {receipt.steps.length} steps</summary><div className={styles.tableWrap}><table>
      <thead><tr><th>Step</th><th>Action</th><th>Model</th><th>Confidence</th><th>Tokens in / out</th><th>Cost</th><th>Time</th></tr></thead>
      <tbody>{receipt.steps.map(step => <tr key={step.index}><td>{step.index + 1}</td><td>{step.action ?? "—"}{step.error && <p>{step.error}</p>}</td><td>{step.calls.map(call => call.model).join(" → ")}</td><td>{step.confidence === undefined ? "—" : Math.round(step.confidence * 100) + "%"}</td><td>{step.calls.map(call => `${call.inputTokens ?? "?"} / ${call.outputTokens ?? "?"}`).join("; ")}</td><td>{step.calls.map(call => call.costUsd === null ? "Unknown" : "$" + call.costUsd.toFixed(6)).join("; ")}</td><td>{step.durationMs}ms</td></tr>)}</tbody>
    </table></div></details>
  </div>;
}
