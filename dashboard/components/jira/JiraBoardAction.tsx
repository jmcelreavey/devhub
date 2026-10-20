"use client";

import { useRef, useState } from "react";
import { mutate } from "swr";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useLive } from "@/lib/hooks/use-fetch";
import type { JiraTicket } from "@/lib/jira/client";
import type { JiraLinkedTask } from "@/lib/tasks/jira-intake";
import type { Task } from "@/lib/tasks/types";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";

const INTAKE_KEY = "/api/tasks/jira-intake";

export function JiraBoardAction({ ticket }: { ticket: JiraTicket }) {
  const detail = useTaskDetail();
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = profile.data ? profile.data.active ?? "legacy" : undefined;
  const linked = useLive<{ profile: string; linked: Record<string, JiraLinkedTask> }>(INTAKE_KEY);
  const [created, setCreated] = useState<(JiraLinkedTask & { profile: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const currentLinks = linked.data?.profile === profileId ? linked.data : undefined;
  const existing = currentLinks?.linked[ticket.key] ?? (created?.profile === profileId ? created : null);

  const add = async () => {
    if (inFlight.current || !profileId || profile.error) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(INTAKE_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: ticket.key, summary: ticket.summary, url: ticket.url, profile: profileId }),
      });
      const result = await response.json() as { task?: Task; date?: string; error?: string };
      if (!response.ok || !result.task || !result.date) throw new Error(result.error ?? "Couldn't add this ticket. Try again.");
      const task = { taskId: result.task.id, date: result.date, profile: profileId };
      setCreated(task);
      void linked.mutate();
      void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/tasks") || key === "/api/sidebar/counts"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't add this ticket. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <div>
    <button type="button" className="btn btn-ghost" disabled={busy || !detail || !profileId || !!profile.error || (!currentLinks && !linked.error)} aria-busy={busy || undefined} onClick={(event) => {
      event.stopPropagation();
      if (existing) detail?.openTask(existing.taskId);
      else void add();
    }}>{busy ? "Adding…" : existing ? "Open task" : "Add to board"}</button>
    {linked.error && !existing ? <p className="text-xs text-text-muted">Links unavailable; Add checks again before saving.</p> : null}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </div>;
}
