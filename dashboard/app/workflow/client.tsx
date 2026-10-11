"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { WORKFLOW_STAGES, type TaskWorkflow } from "@/lib/workflows/types";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import styles from "./workflow.module.css";
import WorkflowInbox from "./WorkflowInbox";

import type { IntegrationRef } from "@/lib/integrations/types";

interface WorkflowResponse {
  integrationProviders?: { id: string; capabilities: string[] }[];
  task: { id: string; text: string; date: string; integrationRefs?: IntegrationRef[] };
  workflow: TaskWorkflow;
  runs: TaskAgentRunRecord[];
}
export default function WorkflowClient() {
  const taskId = useSearchParams().get("taskId");
  return taskId ? <TaskWorkflowClient key={taskId} taskId={taskId} /> : <WorkflowInbox />;
}

function TaskWorkflowClient({ taskId }: { taskId: string }) {
  const { data, error, mutate } = useLive<WorkflowResponse>(taskId ? "/api/tasks/workflow?taskId=" + encodeURIComponent(taskId) : null, { refreshInterval: 5000 });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const busy = pendingAction !== null;
  const [failure, setFailure] = useState("");
  const [reviewRun, setReviewRun] = useState("");
  const [findings, setFindings] = useState("");
  const [verdict, setVerdict] = useState("changes-requested");
  const [kind, setKind] = useState("commit-push");
  const [destination, setDestination] = useState("");
  const [content, setContent] = useState("");

  async function act(action: Record<string, unknown>) {
    if (!data || busy) return;
    setPendingAction(action.action === "decide" ? (action.approve ? "approve:" : "reject:") + String(action.proposalId) : String(action.action));
    setFailure("");
    try {
      const response = await fetch("/api/tasks/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: data.task.id, revision: data.workflow.revision, ...action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the workflow");
      await mutate();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not update the workflow");
      await mutate();
    } finally { setPendingAction(null); }
  }

  async function requestReview() {
    if (!data || busy) return;
    const implementation = data.runs.find((run) => !run.role || run.role === "implement");
    if (!implementation?.cwd) return;
    setPendingAction("request-review");
    setFailure("");
    try {
      const response = await fetch("/api/tasks/implement/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: data.task.id, date: data.task.date, cwd: implementation.cwd, notePath: "pr-reviews/task-" + data.task.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start the reviewer.");
      await mutate();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not start the reviewer.");
    } finally { setPendingAction(null); }
  }

  if (error) return <div className="page-wrapper"><FetchError message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <div className="page-wrapper"><SkeletonRows count={4} /></div>;
  const { workflow, runs, task } = data;
  const workflowStopped = ["paused", "complete", "abandoned"].includes(workflow.status);
  const hasImplementation = runs.some((run) => !run.role || run.role === "implement");
  const reviewers = runs.filter((run) => run.role === "review" && run.status === "done");
  const check = workflow.checks.at(-1);
  const review = workflow.reviews.at(-1);
  const stage = workflow.revision === 0 && hasImplementation ? "implement" : workflow.stage;
  return (
    <div className={"page-wrapper " + styles.page}>
      <Link className={styles.back} href="/workflow"><ArrowLeft size={14} aria-hidden />Task workflows</Link>
      <header className={styles.header}>
        <div><h1>{task.text}</h1><p>Workflow · {workflow.status === "waiting-user" ? "Waiting for you" : workflow.status.replaceAll("-", " ")}</p></div>
        {!["complete", "abandoned"].includes(workflow.status) && <button className="btn btn-ghost" disabled={busy} onClick={() => void act({ action: "status", status: workflow.status === "paused" ? "active" : "paused" })}>{pendingAction === "status" ? "Updating workflow…" : workflow.status === "paused" ? "Resume workflow" : "Pause workflow"}</button>}
      </header>
      <ol className={styles.stages} aria-label="Workflow stages">
        {WORKFLOW_STAGES.map((item, index) => <li key={item} aria-current={item === stage ? "step" : undefined}><span>{index + 1}</span>{item === "draft-pr" ? "Draft PR" : item[0].toUpperCase() + item.slice(1)}</li>)}
      </ol>
      {workflowStopped && <p role="status" className="tone-panel tone-panel--muted">{workflow.status === "paused" ? "Resume this workflow to run checks, record reviews or decide proposals. Pausing does not stop the assistant." : "This workflow is " + workflow.status + ". Its evidence and decisions remain available."}</p>}
      {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}
      <div className={styles.columns}>
        <div>
          <section className={styles.section}>
            <div className={styles.sectionHeading}><h2>Verification</h2><button className="btn btn-primary" disabled={busy || workflowStopped || !hasImplementation || check?.outcome === "running"} onClick={() => void act({ action: "verify" })}>{pendingAction === "verify" && <Loader2 size={14} className="animate-spin" aria-hidden />}Run checks</button></div>
            <p>Runs <code>npm run verify</code> in the implementation checkout. A finished chat does not count as passing checks.</p>
            {check ? <div className="tone-panel tone-panel--muted"><strong>{check.stale ? "Checks need to run again — code changed" : check.outcome === "passed" ? "Checks passed" : "Checks " + check.outcome}</strong><p>{check.detail || check.command}{check.exitCode !== null ? " · exit " + check.exitCode : ""}</p></div> : <p className={styles.empty}>{hasImplementation ? "No checks recorded yet." : "Start implementation from the task to attach a checkout."}</p>}
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}><h2>Independent review</h2><button className="btn btn-ghost" disabled={busy || workflowStopped || check?.stale || check?.outcome !== "passed" || runs.some((run) => run.role === "review" && ["queued", "running"].includes(run.status))} onClick={() => void requestReview()}>{pendingAction === "request-review" ? "Starting reviewer…" : "Request review"}</button></div>
            <p>The assigned reviewer uses the implementation checkout. Read its conversation, then record the findings here. Code changes require another review.</p>
            {review && <div className="tone-panel tone-panel--muted"><strong>{review.stale ? "Review is out of date" : review.verdict === "pass" ? "Review accepted" : "Changes requested"}</strong><p className={styles.pre}>{review.findings}</p></div>}
            <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void act({ action: "review", runId: reviewRun, findings, verdict }); }}>
              <label>Review conversation<select className="input" value={reviewRun} onChange={(event) => setReviewRun(event.target.value)} required><option value="">Choose a completed reviewer</option>{reviewers.map((run) => <option key={run.runId} value={run.runId}>{run.provider} · {run.startedAt}</option>)}</select></label>
              {!reviewers.length && <p className={styles.empty}>No completed reviewer yet. The assigned reviewer must finish before findings can be accepted.</p>}
              <label>Findings and resolutions<textarea className="input" rows={4} value={findings} onChange={(event) => setFindings(event.target.value)} required maxLength={20000} /></label>
              <label>Outcome<select className="input" value={verdict} onChange={(event) => setVerdict(event.target.value)}><option value="changes-requested">Changes required</option><option value="pass">All findings resolved</option></select></label>
              <button className="btn btn-ghost" disabled={busy || workflowStopped || !reviewRun || check?.stale || check?.outcome !== "passed"}>{pendingAction === "review" ? "Saving review…" : "Record review"}</button>
            </form>
          </section>
          <section className={styles.section}>
            <h2>Publication decisions</h2>
            <p>Approval records the exact destination and content for 15 minutes. Your assistant still has local command access; this workflow is not a sandbox.</p>
            {workflow.proposals.map((proposal) => <article key={proposal.id} className={styles.proposal}>
              <div className={styles.sectionHeading}><h3>{proposal.kind.replaceAll("-", " ")}</h3><span className="badge badge-muted">{proposal.state}</span></div>
              <p>{proposal.destination}</p><pre className={styles.pre}>{proposal.content}</pre>
              {proposal.state === "pending" && <div className={styles.actions}><button className="btn btn-primary" disabled={busy || workflowStopped} onClick={() => void act({ action: "decide", proposalId: proposal.id, approve: true })}>{pendingAction === "approve:" + proposal.id ? "Approving…" : "Approve this proposal"}</button><button className="btn btn-ghost" disabled={busy || workflowStopped} onClick={() => void act({ action: "decide", proposalId: proposal.id, approve: false })}>{pendingAction === "reject:" + proposal.id ? "Rejecting…" : "Reject"}</button></div>}
            </article>)}
            <details className={styles.details}><summary>Prepare a proposal</summary><form className={styles.form} onSubmit={(event) => { event.preventDefault(); void act({ action: "propose", kind, destination, content }); }}>
              <label>Action<select className="input" value={kind} onChange={(event) => setKind(event.target.value)}><option value="commit-push">Commit and push</option><option value="draft-pr">Draft PR</option><option value="ticket-transition">Ticket transition</option><option value="task-completion">Complete task</option></select></label>
              <label>Destination<input className="input" value={destination} onChange={(event) => setDestination(event.target.value)} required maxLength={1000} placeholder="Repository, branch or ticket" /></label>
              <label>Exact content<textarea className="input" rows={4} value={content} onChange={(event) => setContent(event.target.value)} required maxLength={20000} /></label>
              <button className="btn btn-ghost" disabled={busy || workflowStopped || check?.stale || review?.stale || check?.outcome !== "passed" || review?.verdict !== "pass" || workflow.stage === "verify"}>{pendingAction === "propose" ? "Preparing proposal…" : "Prepare for approval"}</button>
            </form></details>
          </section>
        </div>
        <aside>
          <section className={styles.section}><h2>Linked integrations</h2><p>Issue, PR and check states remain separate from this task.</p>
            {task.integrationRefs?.length ? <ul className={styles.events}>{task.integrationRefs.map((ref) => <li key={JSON.stringify(ref)}><strong>{ref.id}</strong><span>{ref.provider} · {ref.account} · {ref.kind}</span><span>{data.integrationProviders?.find((p) => p.id === ref.provider)?.capabilities.includes(ref.kind + ".read") ? "Read available" : "Provider unavailable"}</span></li>)}</ul> : <p>No integration links yet.</p>}
            <Link href={"/integrations?taskId=" + encodeURIComponent(task.id)}>Manage links and alerts</Link>
            <Link href={"/browser?taskId=" + encodeURIComponent(task.id)}>Open task browser</Link>
          </section>
          <section className={styles.section}><h2>Conversations</h2><p>Each attempt stays linked to this task. Resume from the task menu keeps the implementation session.</p>
            {runs.length ? <ul className={styles.runs}>{runs.map((run) => <li key={run.runId}><Link href={"/agents?run=" + encodeURIComponent(run.runId)}><strong>{run.role || "implement"}</strong><span>{run.provider || "Agent"} · {run.status}</span><ArrowUpRight size={14} aria-hidden /></Link></li>)}</ul> : <p className={styles.empty}>No conversations yet.</p>}
          </section>
          <section className={styles.section}><div className={styles.sectionHeading}><h2>Updates</h2>{workflow.seenRevision < workflow.revision && <button className="btn btn-ghost" disabled={busy} onClick={() => void act({ action: "seen" })}>{pendingAction === "seen" ? "Marking read…" : "Mark read"}</button>}</div>
            {workflow.events.length ? <ol className={styles.events}>{workflow.events.slice(-20).reverse().map((event) => <li key={event.id}><span>{event.summary}</span><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}</ol> : <p className={styles.empty}>Checks and decisions will appear here.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
