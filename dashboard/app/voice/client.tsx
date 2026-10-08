"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, Loader2, Sparkles } from "lucide-react";
import { FetchError, PageHeader, SkeletonRows } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";
import { formatShortDate } from "@/lib/format-date";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";
import {
  MAX_ANSWER_CHARS,
  type VoiceApplyResult,
  type VoiceProposal,
  type VoiceState,
} from "@/lib/voice/types";

async function postJson<T>(url: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

export default function VoicePage() {
  const shortcutLabel = useShortcutLabel();
  const { data, error, mutate } = useLive<VoiceState>("/api/voice");
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keyed by scenario so switching scenarios shows that scenario's saved text
  // without an effect to reset it.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [proposalText, setProposalText] = useState("");
  const reviewRef = useRef<HTMLElement>(null);

  // The draft renders below the card whose button asked for it; without this it lands off-screen.
  useEffect(() => {
    if (proposal) reviewRef.current?.scrollIntoView({ block: "start" });
  }, [proposal]);

  const scenarios = data?.scenarios ?? [];
  const answers = data?.answers ?? [];
  const answerFor = (id: string) => answers.find((a) => a.scenarioId === id);
  const answeredCount = scenarios.filter((s) => answerFor(s.id)).length;
  const pendingCount = scenarios.filter((s) => {
    const a = answerFor(s.id);
    return a && !a.trainedAt;
  }).length;

  const current = scenarios.find((s) => s.id === selectedId) ?? scenarios.find((s) => !answerFor(s.id)) ?? scenarios[0];
  const saved = current ? (answerFor(current.id)?.answer ?? "") : "";
  const text = current && draft?.id === current.id ? draft.text : saved;
  const dirty = text.trim() !== saved;

  function goToNextAfter(id: string) {
    const start = scenarios.findIndex((s) => s.id === id);
    const ordered = [...scenarios.slice(start + 1), ...scenarios.slice(0, start)];
    const next = ordered.find((s) => !answerFor(s.id)) ?? ordered[0];
    if (next) setSelectedId(next.id);
  }

  async function save(advance: boolean) {
    if (!current) return;
    setSaving(true);
    try {
      await postJson("/api/voice", "PUT", { scenarioId: current.id, answer: text });
      await mutate();
      setDraft(null);
      if (advance) goToNextAfter(current.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that answer.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty && !saving) {
      e.preventDefault();
      void save(true);
    }
  }

  async function draftUpdate() {
    setDrafting(true);
    try {
      const next = await postJson<VoiceProposal>("/api/voice/train", "POST");
      setProposal(next);
      setProposalText(next.content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft an update.");
    } finally {
      setDrafting(false);
    }
  }

  function discardDraft() {
    setProposal(null);
    // The dashboard holds the draft too (so an agent can apply it); drop that copy as well.
    fetch("/api/voice/train", { method: "DELETE" }).catch(() => toast.error("Couldn't discard the saved draft."));
  }

  async function applyUpdate() {
    if (!proposal) return;
    setApplying(true);
    try {
      const result = await postJson<VoiceApplyResult>("/api/voice/apply", "POST", {
        content: proposalText,
        answers: proposal.answers,
      });
      if (result.synced) toast.success("Saved to my-voice and synced to your agent tools.");
      else toast.info(`Saved to my-voice. Syncing to your agent tools failed: ${result.syncError ?? "unknown error"}`);
      setProposal(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the update.");
    } finally {
      setApplying(false);
    }
  }

  const skill = data?.skill;
  const cannotTrain = !skill?.found || skill.readOnly || !data?.aiConfigured || pendingCount === 0;

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <PageHeader
        title="My voice"
        subtitle="Answer a few scenarios the way you'd really write them. DevHub distils your answers into the my-voice skill, so agents and in-app writers sound like you."
        badge={
          data ? <span className="badge badge-muted">{answeredCount}/{scenarios.length} answered</span> : undefined
        }
      />

      {error && <FetchError message={error.message} onRetry={() => void mutate()} />}
      {!data && !error && <SkeletonRows count={3} height={96} />}

      {skill && !skill.found && (
        <p className="tone-panel tone-panel--warning text-sm mb-3" role="alert">
          The my-voice skill isn&apos;t installed, so there&apos;s nothing to train yet. It lives in{" "}
          <code className="text-[11px]">skills/shared/my-voice</code>.
        </p>
      )}
      {skill?.found && skill.readOnly && (
        <p className="tone-panel tone-panel--warning text-sm mb-3" role="alert">
          The my-voice skill is read-only here. You can still answer, but DevHub can&apos;t write the update.
        </p>
      )}

      {scenarios.length > 0 && (
        <nav aria-label="Scenarios" className="flex flex-wrap gap-1 mb-3">
          {scenarios.map((s, i) => {
            const answer = answerFor(s.id);
            const active = s.id === current?.id;
            const state = !answer ? "not answered" : answer.trainedAt ? "answered" : "answered, not learned yet";
            return (
              <button
                key={s.id}
                type="button"
                className={`btn ${active ? "btn-primary" : "btn-ghost"}`}
                style={{ minWidth: 44, justifyContent: "center" }}
                aria-current={active ? "step" : undefined}
                aria-label={`Scenario ${i + 1}, ${state}`}
                title={s.situation}
                onClick={() => setSelectedId(s.id)}
              >
                {answer && <Check size={12} aria-hidden />}
                {i + 1}
              </button>
            );
          })}
        </nav>
      )}

      {current && (
        <section className="card mb-3" aria-labelledby="voice-scenario">
          <div className="card-header">
            <span id="voice-scenario" className="text-sm font-medium">
              Scenario {scenarios.indexOf(current) + 1} of {scenarios.length}
            </span>
            <span className="badge badge-accent">{current.register}</span>
          </div>
          <div className="card-body flex flex-col gap-3">
            <p className="text-sm text-text">{current.situation}</p>
            <label htmlFor="voice-answer" className="text-sm font-medium text-text">
              {current.task}
            </label>
            <textarea
              id="voice-answer"
              className="input"
              rows={6}
              maxLength={MAX_ANSWER_CHARS}
              value={text}
              onChange={(e) => setDraft({ id: current.id, text: e.target.value })}
              onKeyDown={onKeyDown}
              placeholder="Write it exactly as you would send it."
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || saving}
                onClick={() => void save(true)}
              >
                {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
                {saved && !text.trim() ? "Clear answer" : "Save & next"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => goToNextAfter(current.id)}>
                Skip
              </button>
              <span className="ml-auto text-xs text-text-subtle">
                {shortcutLabel("↵")} to save · {text.length}/{MAX_ANSWER_CHARS}
              </span>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section className="card mb-3" aria-labelledby="voice-train">
          <div className="card-header">
            <span id="voice-train" className="text-sm font-medium">Update the skill</span>
            {skill?.learnedModified ? (
              <span className="text-xs text-text-subtle">Last updated {formatShortDate(skill.learnedModified)}</span>
            ) : (
              <span className="text-xs text-text-subtle">Not trained yet</span>
            )}
          </div>
          <div className="card-body flex flex-col gap-3">
            <p className="text-sm text-text-muted" aria-live="polite">
              {pendingCount === 0
                ? "Nothing new to learn from. Answer more scenarios, or edit an answer, to queue an update."
                : `${pendingCount} new ${pendingCount === 1 ? "answer" : "answers"} since the last update. You review the draft before anything is saved.`}
            </p>
            {!data.aiConfigured && (
              <p className="tone-panel tone-panel--warning text-sm">
                No AI provider is configured. Pick one in <Link href="/setup" className="underline text-accent">Setup</Link>.
              </p>
            )}
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={cannotTrain || drafting || proposal !== null}
                onClick={() => void draftUpdate()}
              >
                {drafting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
                {drafting ? "Drafting…" : "Update my voice"}
              </button>
              {drafting && (
                <span className="ml-3 text-xs text-text-subtle" role="status">
                  This can take a minute or two.
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {proposal && (
        <section ref={reviewRef} className="card mb-3" aria-labelledby="voice-review">
          <div className="card-header">
            <span id="voice-review" className="text-sm font-medium">Review the draft</span>
          </div>
          <div className="card-body flex flex-col gap-3">
            <p className="tone-panel tone-panel--accent text-sm">
              Saving replaces <code className="text-[11px]">learned-voice.md</code> and changes how agents write as you.
              Edit anything that doesn&apos;t sound right first.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <h2 className="text-xs font-medium text-text-subtle mb-1">Current</h2>
                <pre className="text-xs whitespace-pre-wrap text-text-muted max-h-[420px] overflow-y-auto">
                  {proposal.current?.trim() || "Nothing yet. This is the first round."}
                </pre>
              </div>
              <div className="min-w-0">
                <label htmlFor="voice-proposal" className="text-xs font-medium text-text-subtle mb-1 block">
                  Proposed
                </label>
                <textarea
                  id="voice-proposal"
                  className="input font-mono text-xs"
                  rows={18}
                  value={proposalText}
                  onChange={(e) => setProposalText(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost" disabled={applying} onClick={discardDraft}>
                Discard
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={applying || !proposalText.trim()}
                onClick={() => void applyUpdate()}
              >
                {applying && <Loader2 size={13} className="animate-spin" aria-hidden />}
                Save to my-voice
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
