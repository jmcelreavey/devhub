"use client";

import { useState } from "react";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { requestNotifyPermission } from "@/lib/desktop/bridge";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import type { TaskWorkflow } from "@/lib/workflows/types";
import styles from "./workflow.module.css";

export interface WorkflowInboxResponse {
  items: Array<{ task: { id: string; text: string }; workflow: TaskWorkflow }>;
}

export default function WorkflowInbox() {
  const { data, error, mutate } = useLive<WorkflowInboxResponse>("/api/tasks/workflow", { refreshInterval: 15000 });
  const [permission, setPermission] = useState("");
  const items = [...(data?.items ?? [])].sort((a, b) => Number(b.workflow.seenRevision < b.workflow.revision) - Number(a.workflow.seenRevision < a.workflow.revision));
  return <div className={"page-wrapper " + styles.page}>
    <Link className={styles.back} href="/work?tab=tasks">Back to tasks</Link>
    <header className={styles.header}>
      <div><h1>Task workflows</h1><p>Checks, review findings and decisions stay here across restarts.</p></div>
      <button className="btn btn-ghost" onClick={() => void requestNotifyPermission().then((value) => setPermission(value === "granted" ? "Desktop alerts enabled. Open this inbox for anything delivered while DevHub was closed." : "Desktop alerts are " + value + ". Updates remain in this inbox."))}>Enable desktop alerts</button>
    </header>
    {permission && <p role="status" className="tone-panel tone-panel--muted">{permission}</p>}
    {error ? <FetchError message={error.message} onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={5} /> :
      items.length ? <ul className={styles.inbox}>{items.map(({ task, workflow }) => <li key={task.id}>
        <Link href={"/workflow?taskId=" + encodeURIComponent(task.id)}>
          <span><strong>{task.text}</strong><span>{workflow.stage.replaceAll("-", " ")} · {workflow.status.replaceAll("-", " ")}</span></span>
          {workflow.seenRevision < workflow.revision && <span className="badge badge-accent">Unread</span>}
        </Link>
      </li>)}</ul> : <section className={styles.section}><h2>No workflows yet</h2><p>Start planning or implementation from a task. Its conversations, checks and approvals will appear here.</p><Link className="btn btn-primary" href="/work?tab=tasks">Open tasks</Link></section>}
  </div>;
}
