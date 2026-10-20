"use client";

import { useRef, useState } from "react";
import { WorkingFolderField, type WorkingFolderChoice } from "@/components/agents/WorkingFolderField";
import { useToast } from "@/lib/hooks/use-toast";
import { postOrchestrate } from "./orchestrate-client";

/**
 * Inline answer to "Which repo should this task run in?". Reuses the Working
 * folder lookup from the agent launch sheet; picking a repo links it to the
 * task and resumes auto in the same request.
 */
export function RepoAnswer({ taskId, taskDate, repoName, onAnswered }: { taskId: string; taskDate: string; repoName?: string; onAnswered?: () => void }) {
  const toast = useToast();
  const [choice, setChoice] = useState<WorkingFolderChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const answer = async (picked: WorkingFolderChoice) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChoice(picked);
    setBusy(true);
    // Only the folder goes over the wire; the server resolves and verifies the
    // canonical repo name from it rather than trusting the folder's display name.
    const result = await postOrchestrate({ action: "answer-repo", taskId, taskDate, cwd: picked.path });
    inFlight.current = false;
    setBusy(false);
    const linked = result.summary?.repoName ?? picked.name;
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't use that repo");
      return;
    }
    if (result.dispatchError) toast.error(`Linked ${linked}, but planning didn't start: ${result.dispatchError}`);
    else if (result.summary?.status === "running") toast.success(`Linked ${linked}; planning resumed`);
    else toast.info(`Linked ${linked}`);
    onAnswered?.();
  };

  return (
    <div className="repo-answer" data-busy={busy || undefined} onClick={(event) => event.stopPropagation()}>
      <WorkingFolderField cwd={choice?.path ?? ""} repoName={repoName} onChange={setChoice} onPick={(picked) => void answer(picked)} />
      {busy ? <p className="mt-1 text-xs text-text-muted" role="status">Linking {choice?.name} and resuming…</p> : null}
    </div>
  );
}
