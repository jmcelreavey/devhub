"use client";

import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { MessageCircle, ArrowRightLeft } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { TeamHandoffPreview } from "@/lib/team/team-handoff";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";

interface TeamMembers { linked: boolean; online?: boolean; members: Array<{ userId: string; userName: string }> }
export async function teamAction(body: object, profile?: string): Promise<unknown> {
  const response = await fetch("/api/team/collaboration" + (profile ? "?taskProfile=" + encodeURIComponent(profile) : ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Couldn't complete that action.");
  return result;
}
export function teamMenuGroups(linked: boolean, readOnly: boolean, open: (kind: "ask" | "handoff") => void): ContextMenuGroup[] {
  return linked && !readOnly ? [{ id: "team", label: "Team", items: [{ id: "team-ask", label: "Ask a teammate…", icon: <MessageCircle size={12} aria-hidden />, onSelect: () => open("ask") }, { id: "team-handoff", label: "Hand off…", icon: <ArrowRightLeft size={12} aria-hidden />, onSelect: () => open("handoff") }] }] : [];
}
export function useTeamTaskActions(card: BoardCard, profile?: string) {
  const members = useLive<TeamMembers>("/api/team/collaboration", { refreshInterval: 60_000 });
  const [kind, setKind] = useState<"ask" | "handoff">();
  const [channel, setChannel] = useState("");
  const [preview, setPreview] = useState<TeamHandoffPreview>();
  const [reassign, setReassign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const toast = useToast();
  const open = (next: "ask" | "handoff") => { setError(""); setPreview(undefined); setKind(next); };
  const close = () => { if (!inFlight.current) setKind(undefined); };
  const choose = async (userId: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await teamAction({ action: kind, taskId: card.taskId, teammate: userId, ...(kind === "ask" && channel.trim() ? { channel: channel.trim() } : {}) }, profile);
      if (kind === "ask") { toast.success("Question sent."); setKind(undefined); }
      else { const next = result as TeamHandoffPreview; setPreview(next); setReassign(next.reassignJira); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't reach team Slack."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await teamAction({ action: "confirm", token: preview.token, reassignJira: reassign }, profile);
      toast.success("Handoff sent."); setKind(undefined);
      void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/tasks")));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't hand off the task."); setPreview(undefined); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const visible = !!members.data?.linked && !isTaskOwnershipBlocked(card.task) && !card.task?.done && !card.task?.abandonedAt;
  const dialogs = <ModalShell open={!!kind} onClose={close} title={preview ? "Hand off to @" + preview.name + "?" : kind === "ask" ? "Ask a teammate" : "Hand off"} dismissOnBackdrop={!busy} dismissOnEscape={!busy}>
    <div className="grid gap-3" aria-busy={busy || undefined}>
      <p className="text-sm text-text-muted">{card.title}</p>
      {preview ? <>
        <div className="tone-panel tone-panel--danger"><p>This stops the running agent, pushes this task’s branch, writes a handoff note and sends it to @{preview.name}. Your task becomes read-only.</p></div>
        {preview.files.length ? <div><p className="text-sm">Uncommitted changes</p><ul className="max-h-48 overflow-y-auto text-xs">{preview.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul></div> : <p className="text-sm">No uncommitted changes.</p>}
        {preview.jira ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={reassign} disabled={busy} onChange={(event) => setReassign(event.target.checked)} />Reassign Jira ticket to them</label> : null}
        <div className="flex gap-2"><button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void confirm()}>{busy ? "Handing off…" : preview.files.length ? "Commit WIP and push" : "Push and hand off"}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={close}>Cancel</button></div>
      </> : <>
        {kind === "ask" ? <label className="grid gap-1 text-sm">Post in… (optional)<input className="input" placeholder="Slack channel ID, or leave blank for a group DM" value={channel} disabled={busy} onChange={(event) => setChannel(event.target.value)} /></label> : null}
        {!members.data ? <SkeletonRows count={2} height={32} /> : members.error ? <FetchError bare message="Couldn't load teammates." onRetry={() => void members.mutate()} /> : !members.data.online ? <FetchError bare message="Team Slack is offline. Reconnect in Setup." onRetry={() => void members.mutate()} /> : members.data.members.length ? <div className="grid gap-1" aria-label="Linked teammates">{members.data.members.map((member) => <button key={member.userId} type="button" className="btn btn-ghost justify-start" disabled={busy} onClick={() => void choose(member.userId)}>@{member.userName}</button>)}</div> : <p className="text-sm text-text-muted">No teammates are linked yet.</p>}
      </>}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  </ModalShell>;
  return { visible, groups: teamMenuGroups(visible, !!card.task?.handoff, open), dialogs, open };
}
export function TeamTaskButtons({ card, profile }: { card: BoardCard; profile?: string }) {
  const team = useTeamTaskActions(card, profile);
  const toast = useToast();
  const previous = useRef({ taskId: card.taskId, profile, handoff: card.task?.handoff });
  useEffect(() => {
    const before = previous.current;
    const handoff = card.task?.handoff;
    previous.current = { taskId: card.taskId, profile, handoff };
    if (before.taskId !== card.taskId || before.profile !== profile || before.handoff?.status !== "pending") return;
    if (!handoff) toast.info("Your handoff to @" + before.handoff.toName + " ended. It's yours again.");
    else if (handoff.handoffId === before.handoff.handoffId && handoff.status === "accepted") toast.success("Handed to @" + handoff.toName);
  }, [card.taskId, card.task?.handoff, profile, toast]);
  if (!team.visible) return null;
  return <><div className="flex flex-wrap gap-1"><button type="button" className="btn btn-ghost text-xs" onClick={() => team.open("ask")}>Ask a teammate…</button><button type="button" className="btn btn-ghost text-xs" onClick={() => team.open("handoff")}>Hand off…</button></div>{team.dialogs}</>;
}

