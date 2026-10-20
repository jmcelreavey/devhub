"use client";
import { useState } from "react";
import Link from "next/link";
import { TaskNoteQuestions } from "@/components/notes/task-note/TaskNoteQuestions";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import { teamAction } from "@/components/storyboard/TeamTaskActions";
export function SuggestedAnswer({ token }: { token: string }) {
  const preview = useLive<{ question: string; answer: string; taskId: string }>(/^[a-f0-9]{32}$/.test(token) ? "/api/team/collaboration?token=" + token : null, { refreshInterval: 0 });
  const [sent, setSent] = useState(false);
  if (!/^[a-f0-9]{32}$/.test(token)) return <p role="alert">That suggested answer is not valid.</p>;
  if (sent) return <p role="status">Answer sent. <Link href="/">Back to Home</Link></p>;
  if (preview.error) return <FetchError bare message={preview.error.message || "That question changed or the suggestion expired."} onRetry={() => void preview.mutate()} />;
  if (!preview.data) return <SkeletonRows count={2} height={48} />;
  return <div className="card p-4 max-w-2xl"><p className="text-sm text-text-muted mb-3">Edit the suggestion before sending it. The agent only sees the answer you send.</p><TaskNoteQuestions autoFocus includeResolved={false} initialAnswers={{ [token]: preview.data.answer }} questions={[{ id: token, text: preview.data.question, resolved: false }]} onOp={async (op) => {
    if (op.op !== "resolve_question" || !op.answer) return false;
    await teamAction({ action: "send", token, answer: op.answer });
    setSent(true);
  }} /></div>;
}

