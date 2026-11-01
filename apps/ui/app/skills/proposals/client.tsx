"use client";
import Link from "@/lib/navigation";
import { useState } from "react";
import { PageHeader, FetchError, EmptyState, SkeletonRows } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import type { SkillProposal, SkillProposalSummary } from "../../../../core/src/lib/skills/proposals";

export default function SkillProposalsPage() {
  const list = useLive<{ proposals: SkillProposalSummary[] }>("/api/skills/proposals");
  const [selected, setSelected] = useState<string>();
  const detail = useLive<SkillProposal>(selected ? "/api/skills/proposals?id=" + encodeURIComponent(selected) : null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const proposal = detail.data?.id === selected ? detail.data : undefined;
  const summary = list.data?.proposals.find(item => item.id === selected);
  async function decide(decision: "accept" | "reject") {
    if (!proposal) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/skills/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, decision, baseRevision: proposal.baseRevision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t save your decision.");
      await Promise.all([list.mutate(), detail.mutate()]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t save your decision."); }
    finally { setPending(false); }
  }
  return <div className="page-wrapper h-full overflow-y-auto">
    <PageHeader title="Skill proposals" subtitle="Review improvements cited from completed runs before they change a shared skill." />
    <Link className="mb-4 inline-block text-sm text-text-muted" href="/skills">Back to agent skills</Link>
    {error ? <p role="alert" className="tone-panel tone-panel--warning mb-4">{error}</p> : null}
    {list.error ? <FetchError message={list.error.message} onRetry={() => void list.mutate()} /> : null}
    {list.isLoading ? <SkeletonRows count={4} /> : list.data?.proposals.length ? <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="card overflow-hidden" aria-label="Skill proposals">{list.data.proposals.map(item => <button type="button" disabled={pending} key={item.id} onClick={() => { setSelected(item.id); setError(""); }} className={"block w-full border-b border-border px-4 py-3 text-left hover:bg-bg-hover " + (selected === item.id ? "bg-bg-elevated" : "")} aria-pressed={selected === item.id}>
        <span className="block text-sm font-medium">{item.skill}</span>
        <span className="mt-1 block text-xs text-text-muted">{item.status === "pending" && item.stale ? "Changed since proposal" : item.status} · {new Date(item.createdAt).toLocaleDateString()}</span>
      </button>)}</div>
      <section className="min-w-0" aria-label="Review selected skill proposal">
        {detail.error ? <FetchError message={detail.error.message} onRetry={() => void detail.mutate()} /> : null}
        {detail.isLoading ? <SkeletonRows count={4} /> : proposal ? <>
          <h2 className="text-lg font-medium">{proposal.skill}</h2><p className="mt-2 text-sm">{proposal.reason}</p>
          <p className="mt-2 text-xs text-text-muted">Source run: <Link className="underline" href={"/agents?run=" + encodeURIComponent(proposal.run.id)}>{proposal.run.title}</Link></p>
          <details className="mt-3 text-sm"><summary className="cursor-pointer">Evidence from the completed run</summary><p className="mt-2 whitespace-pre-wrap text-text-secondary">{proposal.evidence}</p></details>
          {proposal.status === "pending" && summary?.stale ? <p role="status" className="tone-panel tone-panel--warning mt-4 text-sm">{summary.unavailable || "This skill changed after the proposal. Request a fresh proposal; accepting is disabled."}</p> : null}
          <div className="mt-4 grid gap-3 xl:grid-cols-2">{[["Current when proposed", proposal.before], ["Proposed", proposal.after]].map(([label, content]) => <div key={label} className="card overflow-hidden"><h3 className="border-b border-border px-3 py-2 text-xs font-medium">{label}</h3><pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{content}</pre></div>)}</div>
          {proposal.status === "pending" ? <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className="btn btn-primary" disabled={pending || !summary || summary.stale} onClick={() => void decide("accept")}>{pending ? "Saving…" : "Accept skill update"}</button><button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void decide("reject")}>Reject proposal</button><span className="text-xs text-text-muted">Sync to local tools when you’re ready.</span></div> : <p role="status" className="mt-4 text-sm text-text-muted">Proposal {proposal.status}. {proposal.status === "accepted" ? "The shared source is saved. Use the existing skill sync to update local tools." : ""}</p>}
        </> : !detail.error ? <p className="text-sm text-text-muted">Select a proposal to review its source, evidence and changes.</p> : null}
      </section>
    </div> : !list.error ? <EmptyState title="No skill proposals yet" subtitle="A completed run can propose an update with its evidence and the skill revision. You decide whether to accept it here." action={<Link className="btn btn-primary" href="/agents">Open agent chats</Link>} /> : null}
  </div>;
}
