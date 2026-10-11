"use client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ModalShell } from "@/components/shell/ModalShell";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import type { WriteProposal, WriteInput } from "@/lib/integrations/write-types";

function sourceLabel(source: string): string {
  if (source === "DevHub") return source;
  try {
    const [sender, profile] = JSON.parse(source) as [{ provider: string; user: string; channel: string; team?: string }, string];
    return [sender.provider, "user " + sender.user, "conversation " + sender.channel, sender.team ? "workspace " + sender.team : "", "profile " + profile].filter(Boolean).join(" · ");
  } catch { return "Chat request"; }
}
export async function writeRequest(input: unknown): Promise<WriteProposal> {
  const response = await fetch("/api/integrations/writes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update this action. Refresh its status before trying again.");
  return data.proposal;
}
export function WriteReview({ initial, onClose }: { initial: WriteProposal; onClose: (proposal: WriteProposal | null) => void }) {
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState(true); const pending = useRef(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  async function review() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { setProposal(await writeRequest({ action: "review", id: initial.id })); setLoaded(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the action. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    pending.current = true;
    void writeRequest({ action: "review", id: initial.id }).then((value) => {
      if (active) { setProposal(value); setLoaded(true); }
    }).catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : "Could not load the action. Try again.");
    }).finally(() => { if (active) { pending.current = false; setBusy(false); } });
    return () => { active = false; };
  }, [initial.id]);
  async function confirm() {
    if (pending.current || !proposal.digest) return;
    pending.current = true; setBusy(true); setError("");
    try { setProposal(await writeRequest({ action: "confirm", id: proposal.id, digest: proposal.digest, confirmed: true })); }
    catch (e) { setUncertain(true); setError((e instanceof Error ? e.message : "No response was received.") + " Refresh the action list before trying again; the provider may already have changed."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function cancel() {
    if (pending.current) return;
    if (!["requested", "pending"].includes(proposal.state) || uncertain) { onClose(proposal); return; }
    pending.current = true; setBusy(true);
    try { await writeRequest({ action: "cancel", id: proposal.id }); onClose(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not cancel. Refresh the action list."); }
    finally { pending.current = false; setBusy(false); }
  }
  const finished = !["requested", "pending"].includes(proposal.state);
  return <ModalShell open onClose={() => { if (!busy) void cancel(); }} dismissOnBackdrop={false} title={finished ? proposal.state === "succeeded" ? "Action completed" : proposal.state === "unknown" ? "Outcome unknown" : "Action was not completed" : "Review this action"} wrapTitle focusTitle maxWidth="max-w-2xl"
    description={finished || uncertain ? "Check the recorded outcome before starting another action." : busy && loaded ? "Updating this action. Keep this dialog open while its status is recorded." : "Nothing has been sent yet. Confirming sends this exact action once."}
    footer={<div className="flex flex-wrap justify-end gap-2"><button className="btn btn-ghost" disabled={busy} onClick={() => void cancel()}>{finished || uncertain ? "Close" : "Cancel action"}</button>{!finished && !uncertain && loaded && !error && <button className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Sending…" : proposal.prepared?.summary ?? "Confirm action"}</button>}</div>}>
    {busy && !loaded && <SkeletonRows count={4} />}
    {error && <FetchError message={error} onRetry={uncertain ? undefined : () => void review()} />}
    {finished && <p role="status" className={"tone-panel " + (proposal.state === "succeeded" ? "tone-panel--muted" : "tone-panel--warning")}>{proposal.detail}</p>}
    {proposal.prepared && <div className="space-y-4 break-words">
      <p><strong>{proposal.prepared.summary}</strong></p>
      <dl className="space-y-3">
        <div><dt className="text-text-subtle">Requested from</dt><dd>{sourceLabel(proposal.source)}</dd></div>
        <div><dt className="text-text-subtle">Account</dt><dd>{proposal.input.provider} · {proposal.input.account} · {proposal.prepared.actor}</dd></div>
        <div><dt className="text-text-subtle">Destination</dt><dd className="break-all">{proposal.prepared.destination}</dd></div>
        {Object.entries(proposal.prepared.details).map(([key, value]) => <div key={key}><dt className="text-text-subtle">{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt><dd className="whitespace-pre-wrap break-words">{value === null ? "None" : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}
      </dl>
      {!finished && <p className="text-sm text-text-subtle">Expires {new Date(proposal.expiresAt).toLocaleTimeString()}. Changed accounts, branches or remote items require a fresh review.</p>}
      {proposal.receipt?.item?.url?.startsWith("https://") && <a className="btn btn-ghost" href={proposal.receipt.item.url} target="_blank" rel="noopener noreferrer">Open in {proposal.input.provider === "jira" ? "Jira" : "GitHub"}</a>}
    </div>}
  </ModalShell>;
}
export function openWriteReview(proposal: WriteProposal): Promise<WriteProposal | null> {
  return new Promise((resolve) => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<WriteReview initial={proposal} onClose={(result) => { root.unmount(); container.remove(); resolve(result); }} />);
  });
}
export async function proposeAndReview(input: WriteInput) {
  return openWriteReview(await writeRequest({ action: "propose", input }));
}
