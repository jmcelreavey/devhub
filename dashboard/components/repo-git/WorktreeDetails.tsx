import type { ReactNode } from "react";
import Link from "next/link";
import { isWorktreeCleanupReady, type WorktreeInfo } from "@/lib/repos/worktree-info";
import styles from "./WorktreesPanel.module.css";

export function formatWorktreeSize(bytes: number | null | undefined): string {
  if (bytes == null) return "Size unavailable";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

export function WorktreeStatus({ tree }: { tree: WorktreeInfo }) {
  if (tree.prunable) return <span className="badge badge-muted">Folder missing</span>;
  if (tree.locked) return <span className="badge badge-muted">Kept by you</span>;
  if (tree.merge?.openPr) return <a href={tree.merge.openPr.url} target="_blank" rel="noopener noreferrer" className={styles.prLink}><span className="badge badge-accent">PR #{tree.merge.openPr.number} open</span></a>;
  if (tree.runs.some((run) => run.active)) return <span className="badge badge-muted">Agent active</span>;
  if (tree.details?.dirtyCount) return <span className="badge badge-warning">Local changes</span>;
  if (isWorktreeCleanupReady(tree)) return <span className="badge badge-success">Ready to remove</span>;
  return <span className="badge badge-muted">Kept · merge not verified</span>;
}

export function WorktreeDetails({ tree, children }: { tree: WorktreeInfo; children?: ReactNode }) {
  const details = tree.details;
  return <details className={styles.details}>
    <summary>Details &amp; linked work</summary>
    <div className={styles.detailsBody}>
      <div>
        <div className={styles.path}>{tree.branch || `Detached at ${tree.head.slice(0, 7)}`}</div>
        <div className={styles.path}>{tree.path}</div>
      </div>
      {tree.merge && <p>
        {tree.merge.pr ? <a href={tree.merge.pr.url} target="_blank" rel="noopener noreferrer">{tree.merge.reason}</a> : tree.merge.reason}
      </p>}
      {!tree.merge?.pr && !tree.merge?.openPr && tree.pr && <a href={tree.pr.url} target="_blank" rel="noopener noreferrer">
        PR: {tree.pr.state || "State unknown"} · recorded status
      </a>}
      {details && <>
        {details.blockers.length > 0 && <ul>{details.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        <p>{details.dirtyCount ?? "Unknown"} changed files · {tree.merge?.verified ? "Committed changes verified as merged" : `${details.unpushedCount ?? "Unknown"} commits not on remote refs`}</p>
        {details.lastActivity && <p>Last activity {new Date(details.lastActivity).toLocaleDateString()}</p>}
        {details.ignoredPaths.length > 0 && <details className={styles.details}>
          <summary>Ignored local files ({details.ignoredPaths.length})</summary>
          <ul>{details.ignoredPaths.map((file) => <li key={file} className={styles.path}>{file}</li>)}</ul>
        </details>}
      </>}
      {tree.tasks.length > 0 && <div>
        <strong>Linked tasks</strong>
        {tree.tasks.map((task) => <Link key={task.id} href={`/work?date=${task.date}`}>
          {task.jiraKey && !task.title.includes(task.jiraKey) ? `${task.jiraKey} · ` : ""}{task.title}{task.finished ? " · Finished" : ""}
        </Link>)}
      </div>}
      {tree.notes.length > 0 && <div>
        <strong>Notes</strong>
        {tree.notes.map((note) => <Link key={note.href} href={note.href}>{note.title}</Link>)}
      </div>}
      {tree.runs[0] && <Link href={`/agents?run=${tree.runs[0].id}`}>Agent: {tree.runs[0].status}</Link>}
      {children}
    </div>
  </details>;
}
