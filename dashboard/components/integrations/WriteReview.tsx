"use client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, ExternalLink } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { SeverityPill } from "@/components/ui/Severity";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { statusTone } from "@/components/jira/JiraWidget";
import { describeWrite } from "@/lib/integrations/write-view";
import type { WriteProposal } from "@/lib/integrations/write-types";

/** Posts one write step. `direct` is a person's own click: the server runs it immediately and records it. */
export async function writeRequest(input: unknown): Promise<WriteProposal> {
  const direct = typeof input === "object" && input !== null && (input as { action?: string }).action === "direct";
  const response = await fetch("/api/integrations/writes", { method: "POST", headers: { "Content-Type": "application/json", ...(direct ? { "x-devhub-intent": "direct" } : {}) }, body: JSON.stringify(input) });
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
  const view = describeWrite(proposal);
  const receiptUrl = proposal.receipt?.item?.url;
  const resultUrl = receiptUrl?.startsWith("https://") ? receiptUrl : view.link?.href;
  const outcome = proposal.state === "succeeded" ? null : proposal.state === "unknown" ? "Outcome unknown" : proposal.state === "cancelled" ? "Cancelled" : proposal.state === "failed" ? "Not completed" : null;
  // The provider's own sentence is only worth a panel when it says something the heading does not.
  const detail = proposal.detail && proposal.detail !== view.heading && proposal.detail !== proposal.prepared?.summary ? proposal.detail : "";
  const description = finished || uncertain
    ? proposal.state === "succeeded" ? "Sent and recorded in Recent actions." : "Check the recorded outcome before starting another action."
    : busy && loaded ? "Sending. Keep this open while the result is recorded." : "Nothing has been sent yet.";
  return <ModalShell open onClose={() => { if (!busy) void cancel(); }} dismissOnBackdrop={false} title={view.heading} wrapTitle focusTitle maxWidth="max-w-lg"
    description={description}
    footer={<div className="flex flex-wrap justify-end gap-2"><button className="btn btn-ghost" disabled={busy} onClick={() => void cancel()}>{finished || uncertain ? "Close" : "Cancel"}</button>{!finished && !uncertain && loaded && !error && <button className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Sending…" : view.confirmLabel}</button>}</div>}>
    {busy && !loaded && <SkeletonRows count={3} />}
    {error && <FetchError message={error} onRetry={uncertain ? undefined : () => void review()} />}
    {outcome && <p role="status" className="tone-panel tone-panel--warning"><strong>{outcome}.</strong> {detail}</p>}
    {!outcome && detail && <p role="status" className="tone-panel tone-panel--muted">{detail}</p>}
    {proposal.prepared && <div className="space-y-4 break-words">
      {view.subject && <div>
        <p className="font-mono text-xs text-text-subtle">{view.subject.label}</p>
        {view.subject.title && <p className="font-medium">{view.subject.url?.startsWith("https://") ? <a className="underline-offset-2 hover:underline" href={view.subject.url} target="_blank" rel="noopener noreferrer">{view.subject.title}<span className="sr-only"> (opens in a new tab)</span></a> : view.subject.title}</p>}
      </div>}
      {view.change && <p className="flex flex-wrap items-center gap-2">
        <span className="sr-only">Changes from </span><Change kind={view.change.kind} value={view.change.from} />
        <ArrowRight size={14} aria-hidden className="text-text-subtle" />
        <span className="sr-only"> to </span><Change kind={view.change.kind} value={view.change.to} />
      </p>}
      {view.body && <div><p className="text-sm text-text-subtle">{view.body.label}</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm">{view.body.text}</p></div>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {view.facts.map((fact) => <div key={fact.label} className="contents"><dt className="text-text-subtle">{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      <details className="text-sm">
        <summary className="cursor-pointer text-text-subtle">Details</summary>
        <dl className="mt-2 space-y-2">
          {view.technical.map((row) => <div key={row.label}><dt className="text-text-subtle">{row.label}</dt><dd className="break-all font-mono text-xs">{row.value}</dd></div>)}
          {!finished && <div><dt className="text-text-subtle">Expires</dt><dd>{new Date(proposal.expiresAt).toLocaleTimeString()}. If the account, branch or ticket changes first, you will be asked to review again.</dd></div>}
        </dl>
      </details>
      {resultUrl && <a className="btn btn-ghost inline-flex items-center gap-1.5" href={resultUrl} target="_blank" rel="noopener noreferrer">{view.link?.label ?? "Open result"}<ExternalLink size={13} aria-hidden /></a>}
    </div>}
  </ModalShell>;
}
function Change({ kind, value }: { kind: "status" | "branch" | "text"; value: string }) {
  if (kind === "status") return <SeverityPill tone={statusTone(value)}>{value}</SeverityPill>;
  return <code className="rounded bg-bg-elevated px-1.5 py-0.5 text-xs">{value}</code>;
}
export function openWriteReview(proposal: WriteProposal): Promise<WriteProposal | null> {
  return new Promise((resolve) => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<WriteReview initial={proposal} onClose={(result) => { root.unmount(); container.remove(); resolve(result); }} />);
  });
}
