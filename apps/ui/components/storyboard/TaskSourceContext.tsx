"use client";

import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { profileKey } from "@shared/tasks/profile-scope";
import type { SourceContextView } from "../../../core/src/domains/tasks/source-context";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function TaskSourceContext({ taskId, profileId }: { taskId: string; profileId?: string }) {
  const context = useLive<SourceContextView>(profileKey(`/api/tasks/source-context?taskId=${encodeURIComponent(taskId)}`, profileId));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const snapshot = context.data?.snapshot;
  async function update(action: "refresh" | "acknowledge") {
    const endpoint = profileKey("/api/tasks/source-context", profileId);
    if (!context.data || pending || !endpoint) return;
    setPending(true);
    setFailure("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action, revision: snapshot?.revision ?? null, briefRevision: context.data.briefRevision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn’t update source context.");
      await context.mutate(result, false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Couldn’t update source context.");
      await context.mutate();
    } finally { setPending(false); }
  }
  return <section aria-label="Jira source context" className="my-4 rounded-lg border border-border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-medium">Jira source context</h3>
        <p className="text-xs text-text-muted">{snapshot ? context.data?.stale ? "Source or brief needs review before the next handoff." : "Reviewed against the current brief." : "Keep Jira updates beside your brief."}</p></div>
      <button type="button" className="btn btn-ghost" disabled={pending || !context.data} onClick={() => void update("refresh")}>{pending ? "Saving…" : snapshot ? "Refresh Jira" : "Fetch Jira context"}</button>
    </div>
    {context.isLoading ? <SkeletonRows count={1} /> : null}
    {failure || context.error ? <p role="alert" className="mt-2 text-xs text-error">{failure || context.error.message}<button type="button" className="btn btn-ghost" onClick={() => void context.mutate()}>Retry</button></p> : null}
    {snapshot ? <details className="mt-3">
      <summary className="cursor-pointer text-xs text-text-secondary">{snapshot.source.key} · {snapshot.source.summary} · View source snapshot</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-text-muted">Fetched {new Date(snapshot.refreshedAt).toLocaleString()} · revision {snapshot.revision.slice(0, 8)}. Refreshing never replaces the brief.</p>
        {snapshot.source.truncated ? <p className="text-xs text-text-muted">This snapshot is shortened. Open Jira for all comments and complete text.</p> : null}
        <p className="whitespace-pre-wrap">{snapshot.source.description || "No Jira description."}</p>
        {snapshot.source.parent ? <div><h4 className="font-medium">Parent · {snapshot.source.parent.key}</h4><p>{snapshot.source.parent.summary}</p><p className="whitespace-pre-wrap">{snapshot.source.parent.description}</p></div> : null}
        {snapshot.source.links.length ? <div><h4 className="font-medium">Linked tickets</h4><ul>{snapshot.source.links.map((link) => <li key={link.key + link.relationship}>{link.relationship} · {link.key} · {link.summary}</li>)}</ul></div> : null}
        <div><h4 className="font-medium">Comments · {snapshot.source.comments.length} of {snapshot.source.commentTotal}</h4>{snapshot.source.comments.map((comment) => <div className="mt-2" key={comment.id}><p className="text-xs text-text-muted">{comment.author} · {comment.updated}</p><p className="whitespace-pre-wrap">{comment.text}</p></div>)}</div>
        {context.data?.stale ? <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void update("acknowledge")}>Reviewed against this brief</button> : null}
      </div>
    </details> : null}
  </section>;
}
