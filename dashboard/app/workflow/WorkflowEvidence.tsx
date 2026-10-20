"use client";

import type { ReactNode } from "react";
import type { TaskWorkflow, WorkflowCheck, WorkflowProposal, WorkflowReview } from "@/lib/workflows/types";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import type { IntegrationRef } from "@/lib/integrations/types";
import styles from "./workflow.module.css";

export interface TaskWorkflowResponse {
  integrationProviders?: { id: string; capabilities: string[] }[];
  task: { id: string; text: string; date: string; integrationRefs?: IntegrationRef[] };
  workflow: TaskWorkflow;
  runs: TaskAgentRunRecord[];
}

export function CheckEvidence({ check, empty = "No checks recorded yet." }: { check?: WorkflowCheck; empty?: string }) {
  return check ? <div className="tone-panel tone-panel--muted"><strong>{check.stale ? "Checks need to run again — code changed" : check.outcome === "passed" ? "Checks passed" : "Checks " + check.outcome}</strong><p>{check.detail || check.command}{check.exitCode !== null ? " · exit " + check.exitCode : ""}</p></div> : <p className={styles.empty}>{empty}</p>;
}

export function ReviewEvidence({ review, hideFindings = false }: { review?: WorkflowReview; hideFindings?: boolean }) {
  return review ? <div className="tone-panel tone-panel--muted"><strong>{review.stale ? "Review is out of date" : review.verdict === "pass" ? "Review accepted" : "Changes requested"}</strong>{!hideFindings ? <p className={styles.pre}>{review.findings}</p> : null}</div> : null;
}

export function PublicationProposal({ proposal, children }: { proposal: WorkflowProposal; children?: ReactNode }) {
  return <article className={styles.proposal}>
    <div className={styles.sectionHeading}><h3>{proposal.kind.replaceAll("-", " ")}</h3><span className="badge badge-muted">{proposal.state}</span></div>
    <p>{proposal.destination}</p><pre className={styles.pre}>{proposal.content}</pre>
    {children}
  </article>;
}
