"use client";

import { useState } from "react";
import { mutate } from "swr";
import { recoverCardFailure } from "@/app/storyboard/board-actions";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import { useLive } from "@/lib/hooks/use-fetch";
import { profileKey } from "@/lib/tasks/profile-scope";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function TaskFailure({ card, profile, onRefresh, requestedSection }: { requestedSection?: string; card: BoardCard; profile?: string; onRefresh: () => void }) {
  const [guidance, setGuidance] = useState("");
  const [writing, setWriting] = useState(requestedSection === "guidance");
  const [logs, setLogs] = useState(requestedSection === "logs");
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const pending = useTaskActionPending(card.taskId, profile);
  const log = useLive<{ lines: string[] }>(logs ? profileKey(`/api/tasks/failure/output?taskId=${encodeURIComponent(card.taskId)}`, profile) : null);
  if (!card.failure) return null;
  const refresh = () => {
    onRefresh();
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/sidebar/counts")));
  };
  const act = async (action: "clear" | "restore" | "retry" | "resume") => {
    setError(null);
    const result = await recoverCardFailure(card, action, profile, action === "resume" ? guidance : undefined);
    if (!result.ok) setError({ key: card.failure!.key, message: result.error ?? "Couldn't confirm the update. Refresh before retrying." });
    else { setWriting(false); setGuidance(""); }
    refresh();
  };
  return <section aria-label="Failure recovery" className="flex flex-col gap-3">
    {card.failure.cleared ? <div className="flex items-center flex-wrap gap-3 text-xs text-text-muted"><span>Failure cleared · auto paused</span><button type="button" className="text-xs underline underline-offset-4" aria-label="Undo clear" disabled={pending} onClick={() => void act("restore")}>Undo</button></div> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`btn ${card.failure.cleared ? "btn-ghost" : "btn-primary"}`} disabled={pending} onClick={() => void act("retry")}>Retry</button>
      <button type="button" className="btn btn-ghost" disabled={pending} aria-expanded={writing} onClick={() => setWriting(!writing)}>Resume with guidance</button>
      <button type="button" className="btn btn-ghost" aria-expanded={logs} onClick={() => setLogs(!logs)}>Open logs</button>
      {!card.failure.cleared ? <button type="button" className="btn btn-ghost" disabled={pending} title="Dismiss this failure. Keeps history, leaves auto paused, and can be undone." onClick={() => void act("clear")}>Clear failure</button> : null}
    </div>
    {writing ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); if (guidance.trim() && !pending) void act("resume"); }}>
      <label htmlFor={`guidance-${card.taskId}`}>Guidance for this retry</label>
      <textarea id={`guidance-${card.taskId}`} className="input w-full" rows={3} maxLength={4000} value={guidance} onChange={(event) => setGuidance(event.target.value)} autoFocus />
      <button className={`btn ${card.failure.cleared ? "btn-ghost" : "btn-primary"}`} disabled={pending || !guidance.trim()}>{pending ? "Sending…" : "Send"}</button>
    </form> : null}
    {error?.key === card.failure.key ? <p role="alert" className="text-danger">{error.message} <button type="button" className="btn btn-ghost" disabled={pending} onClick={refresh}>Refresh</button></p> : null}
    {logs ? <div className="mt-3">{log.error ? <FetchError bare message="Couldn't load the run logs." onRetry={() => void log.mutate()} /> : !log.data ? <SkeletonRows count={3} /> : <pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto" aria-label="Run logs">{log.data.lines.join("\n") || "No log output was recorded."}</pre>}</div> : null}
  </section>;
}
