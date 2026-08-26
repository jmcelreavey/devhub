"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Check, Dumbbell, ExternalLink, Eye, Repeat } from "lucide-react";
import { FetchError, SkeletonRows } from "@/components";
import { RepStreakStrip } from "@/components/reps/RepStreakStrip";
import { GitDiffView } from "@/components/repo-git/GitDiffView";
import { useLive } from "@/lib/hooks/use-fetch";
import { groupUnifiedDiffByFile, type DiffFileSection } from "@/lib/repos/git-parsers";
import { REP_KIND_LABEL, type PublicRep, type RepsApiPayload } from "@/lib/reps-shared";

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
        <GitDiffView lines={section.lines} filePath={section.path} emptyMessage="No renderable changes." />
      </div>
    </details>
  );
}

/** Diff for today's cold read. Remounts (via key) reset it on swap. */
function DiffPanel() {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/reps/diff");
        const body = (await res.json()) as { diff?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || typeof body.diff !== "string") {
          setError(body.error ?? `Could not load diff (${res.status})`);
        } else {
          setDiff(body.diff);
        }
      } catch {
        if (!cancelled) setError("Could not load the commit diff.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(() => (diff ? groupUnifiedDiffByFile(diff) : []), [diff]);

  return (
    <div className="card mb-4" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="px-3 py-2 text-xs font-medium text-text-muted flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        Diff — commit message hidden until you answer
        {sections.length > 0 && (
          <span className="tabular-nums font-normal" style={{ color: "var(--text-subtle)" }}>
            {sections.length} file{sections.length === 1 ? "" : "s"}
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

function RepPrompt({ rep }: { rep: PublicRep }) {
  const material = rep.material;
  if (material.kind === "cold-read") {
    return (
      <div className="card card-body mb-4">
        <div className="text-xs font-medium text-text-muted mb-1">
          {material.repo} · <span className="font-mono">{material.sha.slice(0, 7)}</span> ·{" "}
          <span className="tabular-nums">
            {material.filesChanged} file{material.filesChanged === 1 ? "" : "s"},{" "}
            <span style={{ color: "var(--success)" }}>+{material.additions}</span>{" "}
            <span style={{ color: "var(--danger)" }}>−{material.deletions}</span>
          </span>
        </div>
        <p className="text-sm m-0">
          A commit from your repo that you didn&apos;t write, message hidden. Read it cold: <strong>what does
          this change do, and what would you have flagged in review?</strong>
        </p>
      </div>
    );
  }
  if (material.kind === "gap-sketch") {
    const realPaths = material.paths.filter((p) => p !== ".");
    const subject = realPaths.length ? (
      <span className="font-mono">{realPaths.join(", ")}</span>
    ) : (
      <span>the {material.repo.split("/")[1] ?? material.repo} repo</span>
    );
    return (
      <div className="card card-body mb-4">
        <div className="text-xs font-medium text-text-muted mb-1">
          {material.repo} · {material.label} ·{" "}
          <span className="tabular-nums">
            {material.commits90d} commits in 90d, {material.authoredByMe} yours
          </span>
        </div>
        <p className="text-sm m-0">
          Your weakest domain in a repo you own. From memory: <strong>what lives in {subject}, what is
          it responsible for, and what talks to it?</strong> No peeking at the code.
        </p>
      </div>
    );
  }
  return (
    <div className="card card-body mb-4">
      <div className="text-xs font-medium text-text-muted mb-1">Diagram: {material.title}</div>
      <p className="text-sm m-0">
        You drew this once. <strong>Redraw &ldquo;{material.title}&rdquo; from memory</strong> — list the
        boxes and the arrows between them before you look.
      </p>
    </div>
  );
}

function RepReveal({ rep }: { rep: PublicRep }) {
  const reveal = rep.reveal;
  if (!reveal) return null;
  if (reveal.kind === "cold-read") {
    return (
      <div className="card card-body mb-4">
        <div className="text-xs font-medium text-text-muted mb-2 inline-flex items-center gap-1.5">
          <Eye size={12} aria-hidden /> The actual commit message
        </div>
        <p className="text-sm font-medium m-0">{reveal.subject}</p>
        {reveal.body && (
          <pre
            className="text-sm mt-2 mb-0"
            style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", color: "var(--text-subtle)" }}
          >
            {reveal.body}
          </pre>
        )}
        <div className="text-xs text-text-subtle mt-2 flex items-center gap-2">
          {reveal.author && <span>by {reveal.author}</span>}
          <a
            href={reveal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-text transition-colors"
          >
            View on GitHub <ExternalLink size={10} aria-hidden />
          </a>
        </div>
      </div>
    );
  }
  if (reveal.kind === "gap-sketch") {
    return (
      <div className="card card-body mb-4">
        <div className="text-xs font-medium text-text-muted mb-2 inline-flex items-center gap-1.5">
          <Eye size={12} aria-hidden /> What actually happened there recently
        </div>
        {reveal.recentSubjects.length > 0 ? (
          <ul className="text-sm m-0 pl-4 space-y-0.5">
            {reveal.recentSubjects.map((subject) => (
              <li key={subject}>{subject}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-subtle m-0">No recent commits in this domain.</p>
        )}
        <div className="mt-2">
          <Link href={reveal.learnHref} className="text-xs inline-flex items-center gap-1 hover:text-text transition-colors">
            <BookOpen size={11} aria-hidden /> Open the learn pack to check your sketch
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="card card-body mb-4">
      <div className="text-xs font-medium text-text-muted mb-2 inline-flex items-center gap-1.5">
        <Eye size={12} aria-hidden /> The real diagram
      </div>
      <Link href={reveal.href} className="text-sm inline-flex items-center gap-1 hover:text-text transition-colors">
        Open it and compare against what you wrote <ExternalLink size={11} aria-hidden />
      </Link>
    </div>
  );
}

export default function RepView() {
  const { data, error, isLoading, mutate } = useLive<RepsApiPayload>("/api/reps");
  const rep = data?.rep ?? null;
  const stats = data?.stats;

  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setSubmitError(null);
    try {
      await post(body);
      await mutate();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const placeholder =
    rep?.material.kind === "cold-read"
      ? "What does this change do? What would you flag?"
      : rep?.material.kind === "gap-sketch"
        ? "Sketch the domain: responsibilities, key pieces, what talks to what…"
        : "List the boxes and arrows from memory…";

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
          <h1 className="page-title" style={{ fontFamily: "var(--font-display)" }}>
            Daily rep
          </h1>
          {stats && stats.streak > 0 && (
            <div className="text-xs mt-1 text-text-subtle">{stats.streak}-day streak</div>
          )}
        </div>
        {rep && (
          <span className="badge" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
            {REP_KIND_LABEL[rep.kind]}
          </span>
        )}
      </div>

      {error && <FetchError message="Couldn't load today's rep." />}
      {isLoading && !data && <SkeletonRows count={4} height={24} variant="list" />}

      {data && !rep && (
        <div className="card card-body">
          <p className="text-sm m-0 mb-3">
            One rep a day, from your own repos: read a stranger&apos;s commit cold, sketch a domain you own
            but don&apos;t know, or redraw one of your diagrams from memory.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act({ action: "start" })}>
            <Dumbbell size={12} aria-hidden /> Start today&apos;s rep
          </button>
          {submitError && <p className="text-xs mt-2 mb-0" style={{ color: "var(--danger)" }}>{submitError}</p>}
        </div>
      )}

      {rep && (
        <>
          <RepPrompt rep={rep} />
          {rep.material.kind === "cold-read" && <DiffPanel key={rep.material.sha} />}

          {!rep.completedAt && (
            <div className="card card-body mb-4">
              <textarea
                value={response}
                onChange={(event) => setResponse(event.target.value)}
                placeholder={placeholder}
                rows={8}
                className="w-full text-sm rounded p-2"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  resize: "vertical",
                }}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !response.trim()}
                  onClick={() => void act({ action: "save", response: response.trim() })}
                >
                  <Check size={12} aria-hidden /> Save & reveal
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void act({ action: "swap" })}
                  title="Different material, same day"
                >
                  <Repeat size={12} aria-hidden /> Swap
                </button>
              </div>
              {submitError && <p className="text-xs mt-2 mb-0" style={{ color: "var(--danger)" }}>{submitError}</p>}
            </div>
          )}

          {rep.completedAt && (
            <>
              <div className="card card-body mb-4">
                <div className="text-xs font-medium text-text-muted mb-2">What you wrote</div>
                <pre className="text-sm m-0" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                  {rep.response}
                </pre>
              </div>
              <RepReveal rep={rep} />
            </>
          )}
        </>
      )}

      {stats && stats.recent.some((day) => day.done) && (
        <div className="mt-6">
          <RepStreakStrip days={stats.recent} />
        </div>
      )}
    </div>
  );
}
