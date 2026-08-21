"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  FileText,
  RefreshCw,
  Repeat,
} from "lucide-react";
import { FetchError, SkeletonRows } from "@/components";
import { RepStreakStrip } from "@/components/reps/RepStreakStrip";
import { GitDiffView } from "@/components/repo-git/GitDiffView";
import { useLive } from "@/lib/hooks/use-fetch";
import { notifyPrReviewNoteWatch, prReviewNotePath } from "@/lib/pr-review-notes";
import { launchAgentJob } from "@/lib/agent-job";
import { agentReviewCommand, agentReviewPrompt } from "@/lib/terminal-launch";
import { groupUnifiedDiffByFile, type DiffFileSection } from "@/lib/repos/git-parsers";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { Rep, RepsApiPayload } from "@/lib/reps";

function Stepper({
  label,
  value,
  onChange,
  tone,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-subtle min-w-28">{label}</span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: "2px 8px" }}
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label={`Fewer ${label}`}
      >
        <ChevronLeft size={12} aria-hidden />
      </button>
      <span className="font-mono tabular-nums text-sm w-6 text-center" style={{ color: tone }}>
        {value}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: "2px 8px" }}
        onClick={() => onChange(value + 1)}
        aria-label={`More ${label}`}
      >
        <ChevronRight size={12} aria-hidden />
      </button>
    </div>
  );
}

function StepChips({ completed }: { completed: boolean }) {
  const chip = (n: number, label: string, state: "done" | "active" | "todo") => (
    <span
      key={label}
      className="badge inline-flex items-center gap-1"
      style={{
        background: state === "todo" ? "var(--bg-elevated)" : state === "done" ? "var(--success-dim, var(--accent-dim))" : "var(--accent-dim)",
        color: state === "todo" ? "var(--text-subtle)" : state === "done" ? "var(--success, var(--accent))" : "var(--accent)",
      }}
    >
      {n} · {label}
    </span>
  );
  return (
    <div className="flex items-center gap-1.5">
      {chip(1, "Solo review", completed ? "done" : "active")}
      {chip(2, "Compare & grade", completed ? "active" : "todo")}
    </div>
  );
}

function FileDiff({ section }: { section: DiffFileSection }) {
  const summary = section.binary ? "binary" : `+${section.additions} −${section.deletions}`;
  return (
    <details className="rounded" style={{ border: "1px solid var(--border)" }} open>
      <summary
        className="px-3 py-1.5 text-xs cursor-pointer select-none flex items-center gap-2 hover:bg-[var(--bg-muted)] transition-colors"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span className="min-w-0 truncate flex-1" style={{ color: "var(--text)" }}>
          {section.path}
        </span>
        <span className="shrink-0 tabular-nums" style={{ color: "var(--text-subtle)" }}>
          {summary}
        </span>
      </summary>
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <GitDiffView lines={section.lines} emptyMessage="No renderable changes." />
      </div>
    </details>
  );
}

function SwapPicker({
  current,
  onPicked,
  onDone,
}: {
  current: Rep["pr"];
  onPicked: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<GithubPrsApiPayload["reviews"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rows || error) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/github/prs");
        const body = (await res.json()) as GithubPrsApiPayload;
        if (!cancelled) setRows(body.reviews ?? []);
      } catch {
        if (!cancelled) setError("Couldn't load the review queue.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, error]);

  const others = (rows ?? [])
    .filter((r) => !current || r.repo !== current.repo || r.number !== current.number)
    .slice(0, 5);

  async function swap(repo: string, number: number, title: string, url: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repick", pr: { repo, number, title, url } }),
      });
      if (res.ok) {
        onPicked();
        onDone();
      } else {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Swap failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      <div className="text-xs font-medium mb-1.5 text-text-muted">Swap today&apos;s rep for…</div>
      {error && <p className="text-xs text-text-subtle">{error}</p>}
      {!rows && !error && <p className="text-xs text-text-subtle">Loading queue…</p>}
      {rows && others.length === 0 && (
        <p className="text-xs text-text-subtle">Nothing else in the queue — this one&apos;s your rep.</p>
      )}
      <div className="space-y-1">
        {others.map((r) => (
          <button
            key={`${r.repo}#${r.number}`}
            type="button"
            disabled={busy}
            onClick={() => void swap(r.repo, r.number, r.title, r.url)}
            className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[var(--bg-muted)] transition-colors flex items-center gap-2 min-w-0"
          >
            <Repeat size={11} aria-hidden className="shrink-0" style={{ color: "var(--text-subtle)" }} />
            <span className="min-w-0 truncate">{r.title}</span>
            <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-subtle)" }}>
              {r.repo}#{r.number}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Owns diff fetching for one PR pick. Remounts (via key) reset it on swap. */
function DiffPanel({ pr }: { pr: NonNullable<Rep["pr"]> }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/reps/diff?repo=${encodeURIComponent(pr.repo)}&number=${pr.number}`);
        const body = (await res.json()) as { diff?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || typeof body.diff !== "string") {
          setError(body.error ?? `Could not load diff (${res.status})`);
        } else {
          setDiff(body.diff);
        }
      } catch {
        if (!cancelled) setError("Could not load PR diff.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pr]);

  const sections = useMemo(() => (diff ? groupUnifiedDiffByFile(diff) : []), [diff]);
  const totalAdd = sections.reduce((n, s) => n + s.additions, 0);
  const totalDel = sections.reduce((n, s) => n + s.deletions, 0);

  return (
    <div className="card mb-4" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="px-3 py-2 text-xs font-medium text-text-muted flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        Diff
        {sections.length > 0 && (
          <span className="tabular-nums font-normal" style={{ color: "var(--text-subtle)" }}>
            {sections.length} file{sections.length === 1 ? "" : "s"} ·{" "}
            <span style={{ color: "var(--success)" }}>+{totalAdd}</span>{" "}
            <span style={{ color: "var(--danger)" }}>−{totalDel}</span>
          </span>
        )}
      </div>
      {!error && diff === null && <SkeletonRows count={6} height={20} variant="list" />}
      {!error && diff !== null && (
        <div className="p-2 space-y-2" style={{ maxHeight: "70vh", overflow: "auto" }}>
          {sections.map((s) => (
            <FileDiff key={`${s.path}:${s.lines.length}`} section={s} />
          ))}
          {sections.length === 0 && <p className="text-sm text-text-subtle px-3 py-2">Empty diff.</p>}
        </div>
      )}
      {error && <FetchError message={error} />}
    </div>
  );
}

function seedNoteMarkdown(rep: Rep): string {
  const pr = rep.pr!;
  const lines = [
    `# ${pr.title}`,
    "",
    `**PR:** [${pr.repo}#${pr.number}](${pr.url})`,
    "",
    "## Review",
    "",
    "**My AI-free findings**",
    "",
    rep.findings ?? "",
    "",
    "## Notes",
    "",
    "- ",
  ];
  return lines.join("\n");
}

export default function RepView() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useLive<RepsApiPayload>("/api/reps");
  const rep = data?.rep ?? null;
  const stats = data?.stats;
  const agentReview = data?.agentReview;

  const [findings, setFindings] = useState("");
  const [saving, setSaving] = useState(false);
  const [caught, setCaught] = useState(0);
  const [missed, setMissed] = useState(0);
  const [grading, setGrading] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pr = rep?.pr;
  const notePath = pr ? prReviewNotePath(pr) : null;

  // Phase B polls faster so the agent review shows up as soon as the note lands.
  const waitingForAgent = !!rep?.completedAt && !rep.grade && !agentReview;
  useEffect(() => {
    if (!waitingForAgent) return;
    const t = setInterval(() => void mutate(), 5000);
    return () => clearInterval(t);
  }, [waitingForAgent, mutate]);


  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/reps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Request failed (${res.status})`);
    }
    return (await res.json()) as RepsApiPayload;
  }

  async function saveFindings() {
    if (!findings.trim()) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await post({ action: "save", findings: findings.trim() });
      await mutate();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save findings.");
    } finally {
      setSaving(false);
    }
  }

  async function saveGrade() {
    setGrading(true);
    setSubmitError(null);
    try {
      await post({ action: "grade", caught, missed });
      await mutate();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save grade.");
    } finally {
      setGrading(false);
    }
  }

  async function reviewWithAgent() {
    if (!pr) return;
    await launchAgentJob({
      title: `Review PR #${pr.number}`,
      kind: "review",
      repoName: pr.repo,
      notePath: notePath ?? undefined,
      promptText: agentReviewPrompt(pr.url, notePath ?? undefined),
      promptCommand: await agentReviewCommand(pr.url, notePath ?? undefined),
      mode: "oneshot",
      reason: `Daily rep review ${pr.repo}#${pr.number}`,
      alreadyConfirmed: true,
    });
    if (pr) notifyPrReviewNoteWatch(pr);
  }

  async function openNote() {
    if (!rep || !rep.pr) return;
    const result = await createOrOpenVaultNote({
      path: prReviewNotePath(rep.pr),
      markdown: seedNoteMarkdown(rep),
    });
    router.push(result.href);
  }

  return (
    <div className="page-wrapper">
      <div
        className="page-header"
        style={{ alignItems: "flex-end", marginBottom: "var(--space-8)", gap: "var(--space-4)" }}
      >
        <div>
          <Link
            href="/review"
            className="text-xs text-text-subtle inline-flex items-center gap-1 hover:text-text transition-colors"
          >
            <ArrowLeft size={11} aria-hidden /> Weekly review
          </Link>
          <div className="page-title" style={{ fontFamily: "var(--font-display)" }}>
            Daily rep
          </div>
          {stats && stats.streak > 0 && (
            <div className="text-xs mt-1 text-text-subtle">
              {stats.streak}-day streak
              {stats.gradedCount > 0 &&
                ` · ${stats.caughtTotal} caught / ${stats.missedTotal} missed across ${stats.gradedCount} graded reps`}
            </div>
          )}
        </div>
      </div>

      {error && <FetchError message="Couldn't load today's rep." />}
      {submitError && <FetchError message={submitError} />}
      {isLoading && !data && <SkeletonRows count={3} height={48} variant="list" />}

      {data && !rep && (
        <div className="card card-body">
          <p className="text-sm text-text-subtle">
            No rep picked yet. Start one from the{" "}
            <Link href="/review" className="text-accent hover:underline">
              weekly review
            </Link>{" "}
            page — it picks the top PR awaiting your review.
          </p>
        </div>
      )}

      {data && rep && pr && (
        <>
          <div className="card card-body mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2 min-w-0">
                <Dumbbell size={14} aria-hidden style={{ color: "var(--accent)", marginTop: 2 }} />
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{pr.title}</div>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-text-subtle hover:text-accent transition-colors"
                  >
                    {pr.repo}#{pr.number}
                  </a>
                </div>
              </div>
              <StepChips completed={!!rep.completedAt} />
            </div>
            {stats && stats.recent.some((d) => d.done) && (
              <div className="mt-3">
                <RepStreakStrip days={stats.recent} />
              </div>
            )}
            {!rep.completedAt && (
              <>
                <p className="text-xs text-text-subtle mt-3">
                  Review this diff yourself first — no AI. Write what you&apos;d flag, then unlock the agent
                  comparison.
                </p>
                <button
                  type="button"
                  className="btn btn-ghost mt-2"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => setShowSwap((s) => !s)}
                >
                  <Repeat size={12} aria-hidden /> {showSwap ? "Hide swap" : "Not this one? Swap PR"}
                </button>
                {showSwap && (
                  <SwapPicker
                    current={pr}
                    onPicked={() => void mutate()}
                    onDone={() => setShowSwap(false)}
                  />
                )}
              </>
            )}
          </div>

          {!rep.completedAt ? (
            <>
              <DiffPanel key={`${pr.repo}#${pr.number}`} pr={pr} />

              <div className="card card-body">
                <div className="text-xs font-medium mb-2 text-text-muted">Your findings</div>
                <textarea
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  aria-label="Your AI-free review findings"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void saveFindings();
                    }
                  }}
                  rows={8}
                  placeholder="One bullet per finding. What would you flag, question, or ask the author?"
                  className="w-full px-3 py-2 rounded text-sm resize-y font-mono"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!findings.trim() || saving}
                    onClick={() => void saveFindings()}
                  >
                    <Check size={12} aria-hidden /> Save findings & unlock AI review
                  </button>
                  <span className="text-xs text-text-subtle">⌘/Ctrl+Enter to save</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-4">
                <div className="card card-body">
                  <div className="text-xs font-medium mb-2 text-text-muted">Your findings</div>
                  <pre className="text-xs whitespace-pre-wrap font-mono m-0" style={{ color: "var(--text)" }}>
                    {rep.findings}
                  </pre>
                </div>
                <div className="card card-body">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="text-xs font-medium text-text-muted">Agent review</div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => void reviewWithAgent()}
                      >
                        <Bot size={12} aria-hidden /> Review with agent
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => void openNote()}
                        aria-label="Open PR note (seeded with your findings)"
                      >
                        <FileText size={12} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {agentReview ? (
                    <pre
                      className="text-xs whitespace-pre-wrap font-mono m-0 px-2 py-1.5 rounded"
                      style={{ color: "var(--text)", background: "var(--bg-elevated)", maxHeight: "50vh", overflow: "auto" }}
                    >
                      {agentReview}
                    </pre>
                  ) : (
                    <p className="text-sm text-text-subtle inline-flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" aria-hidden />
                      Run the agent review — its note appears here automatically.
                    </p>
                  )}
                </div>
              </div>

              <div className="card card-body">
                {rep.grade ? (
                  <p className="text-sm text-text-subtle">
                    Graded: caught {rep.grade.caught}, missed {rep.grade.missed}
                    {rep.grade.caught + rep.grade.missed > 0 &&
                      ` · ${Math.round((rep.grade.caught / (rep.grade.caught + rep.grade.missed)) * 100)}% of the agent's findings you'd already flagged`}
                    . Come back tomorrow.
                  </p>
                ) : (
                  <>
                    <div className="text-xs font-medium mb-3 text-text-muted">
                      Grade it — how did you do against the agent?
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mb-3">
                      <Stepper label="You'd flagged" value={caught} onChange={setCaught} tone="var(--success)" />
                      <Stepper label="You missed" value={missed} onChange={setMissed} tone="var(--danger)" />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={grading}
                      onClick={() => void saveGrade()}
                    >
                      <Check size={12} aria-hidden /> Save grade
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
