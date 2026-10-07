"use client";

import { useRef, useState } from "react";
import { Rocket, Loader2 } from "lucide-react";
import { useReposActions } from "@/app/repos/useReposActions";
import type { RepoInfo } from "@/app/repos/types";
import { useToast } from "@/lib/hooks/use-toast";

const noRefresh = async () => undefined;

export function useTaskUpstart(taskId: string, repoName?: string) {
  const actions = useReposActions({ mutateLocal: noRefresh, mutateGithub: noRefresh });
  const toast = useToast();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  async function start() {
    if (!repoName || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/repos/${encodeURIComponent(repoName)}`);
      if (!response.ok) throw new Error("Could not find this task’s local repository.");
      const payload = await response.json() as { repo: RepoInfo };
      if (!payload.repo?.path || payload.repo.name !== repoName) throw new Error("Invalid repository response.");
      await actions.openUpstart(payload.repo, false, undefined, taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start this task’s checkout.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { start, busy };
}

export function TaskUpstartButton({ start, busy }: ReturnType<typeof useTaskUpstart>) {
  return <button type="button" className="task-agent-chip min-h-6 disabled:opacity-50" disabled={busy}
    title="Start the checkout associated with this task" aria-label="Upstart task checkout"
    onClick={(event) => { event.stopPropagation(); void start(); }}>
    {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Rocket size={12} aria-hidden />}
    {busy ? "Preparing…" : "Upstart"}
  </button>;
}
