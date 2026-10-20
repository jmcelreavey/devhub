"use client";

import { useState } from "react";
import { decidePlan } from "@/app/storyboard/board-actions";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { useTaskActionPending } from "@/lib/storyboard/task-action";

export function PlanApproval({ card, profile, onRefresh, revise = false }: { card: BoardCard; profile?: string; revise?: boolean; onRefresh: () => void }) {
  const [revising, setRevising] = useState(revise);
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<"approve" | "revise">();
  const pending = useTaskActionPending(card.taskId, profile);
  const decide = async (decision: "approve" | "revise") => {
    setError("");
    const result = await decidePlan(card, decision, profile, decision === "revise" ? guidance : undefined);
    if (!result.ok) setError(result.error ?? "Couldn’t update the plan. Your feedback is still here.");
    else setSubmitted(decision);
    onRefresh();
  };
  if (submitted) return <p role="status">{submitted === "revise" ? "Revision requested · planning again on Auto" : "Plan approved · continuing on Auto"}</p>;
  return <div className="grid gap-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void decide("approve")}>{pending ? "Working…" : "Approve plan"}</button>
      <button type="button" className="btn btn-ghost" disabled={pending} aria-expanded={revising} onClick={() => setRevising((value) => !value)}>Revise</button>
    </div>
    {revising ? <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (guidance.trim() && !pending) void decide("revise"); }}>
      <label className="grid gap-2 text-sm">What should change in the plan?
        <textarea className="input" autoFocus rows={3} maxLength={4000} required value={guidance} onChange={(event) => setGuidance(event.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary justify-self-start" disabled={pending || !guidance.trim()}>{pending ? "Sending…" : "Send revision"}</button>
    </form> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
  </div>;
}
