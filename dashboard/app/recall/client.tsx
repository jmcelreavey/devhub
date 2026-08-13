"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Database,
  GitCommitHorizontal,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { EmptyState, FetchError, LoadingLine, SearchInput } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { formatShortDate } from "@/lib/format-date";
import { RECALL_SOURCE_KINDS, type RecallResult, type RecallSourceKind } from "@/lib/recall/types";

interface IndexStatus {
  manifest: {
    builtAt: string;
    chunkCount: number;
    bySource: Record<string, number>;
    embedder: string;
    tookMs: number;
  } | null;
  stale: boolean;
  events: number;
}

const SOURCE_LABEL: Record<RecallSourceKind, string> = {
  note: "Note",
  learning: "Learning",
  doc: "Doc",
  task: "Tasks",
  event: "Event",
  diagram: "Diagram",
};

/**
 * Example queries, shown on the empty state.
 *
 * Not decoration — the failure mode of a search box over an unfamiliar corpus
 * is that people type one word, get nothing useful, and never come back. These
 * demonstrate the shape of query this ranks well on, which is the thing that
 * distinguishes recall from the ⌘K palette sitting next to it.
 */
const EXAMPLES = [
  "why did the desktop bundle end up bigger than planned",
  "how do we handle git hook failures",
  "what broke in the notes editor",
  "one-time share links",
];

function scoreBar(value: number, max: number): string {
  if (max <= 0) return "0%";
  return `${Math.min(100, Math.round((value / max) * 100))}%`;
}

export default function RecallPage() {
  const [input, setInput] = useState("");
  const [budget, setBudget] = useState(2000);
  const [alpha, setAlpha] = useState(0.5);
  const [kinds, setKinds] = useState<RecallSourceKind[]>([]);
  const [result, setResult] = useState<RecallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"index" | "ingest" | null>(null);

  const toast = useToast();
  const {
    data: status,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useLive<IndexStatus>("/api/recall/index");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (query: string, opts: { budget: number; alpha: number; kinds: RecallSourceKind[] }) => {
      if (!query.trim()) {
        setResult(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: query,
          budget: String(opts.budget),
          alpha: String(opts.alpha),
        });
        if (opts.kinds.length > 0) params.set("kinds", opts.kinds.join(","));
        const res = await fetch(`/api/recall?${params}`);
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Recall failed (${res.status})`);
        }
        setResult((await res.json()) as RecallResult);
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : "Recall failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Re-running on control changes rather than requiring a second Enter: the
  // sliders are only meaningful *against* a result set, so making the user
  // re-submit to see their effect hides the thing they were adjusting.
  useEffect(() => {
    if (!input.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void run(input, { budget, alpha, kinds }), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, budget, alpha, kinds, run]);

  const post = useCallback(
    async (path: string, body: unknown, label: string, which: "index" | "ingest") => {
      setBusy(which);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          manifest?: { chunkCount: number; tookMs: number };
          written?: number;
        };
        if (!res.ok) throw new Error(payload.error ?? `${label} failed (${res.status})`);
        toast.success(
          payload.manifest
            ? `${label}: ${payload.manifest.chunkCount} chunks in ${payload.manifest.tookMs}ms`
            : `${label}: ${payload.written ?? 0} new event(s)`,
        );
        await mutateStatus();
        if (input.trim()) await run(input, { budget, alpha, kinds });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${label} failed`);
      } finally {
        setBusy(null);
      }
    },
    [alpha, budget, input, kinds, mutateStatus, run, toast],
  );

  const toggleKind = (kind: RecallSourceKind): void => {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const manifest = status?.manifest ?? null;
  const maxScore = result?.hits[0]?.score ?? 0;

  /**
   * "Still fetching" and "genuinely has no index" are different states and must
   * not share a label. Rendering `status?.manifest ?? null` alone told a user
   * with a perfectly good 1979-chunk index that nothing was built, every time
   * they loaded the page, for as long as the request took.
   */
  const indexUnknown = statusLoading && status === undefined;

  return (
    <div className="page-wrapper">
      {/* items-start: multi-line subtitle vs action cluster (see VaultIndexPage). */}
      <header className="page-header items-start mb-6">
        <div className="min-w-0">
          <div className="page-title">Recall</div>
          <div className="page-subtitle">
            Ranked, budgeted, cited context across notes, docs, tasks and the event spine.{" "}
            <Link href="/search" className="underline text-accent">
              Plain search
            </Link>{" "}
            if you want filename matching instead.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="badge badge-muted">
            {indexUnknown ? "…" : manifest ? `${manifest.chunkCount} chunks` : "no index"}
          </span>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            style={{ padding: "4px 8px" }}
            disabled={busy !== null}
            onClick={() => void post("/api/recall/ingest", { allRepos: true }, "Ingest", "ingest")}
          >
            <GitCommitHorizontal size={12} className={busy === "ingest" ? "animate-spin" : ""} />
            Ingest git
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            style={{ padding: "4px 8px" }}
            disabled={busy !== null}
            onClick={() => void post("/api/recall/index", { clear: true }, "Rebuild", "index")}
          >
            <RefreshCw size={12} className={busy === "index" ? "animate-spin" : ""} />
            Rebuild
          </button>
        </div>
      </header>

      <div className="card card-body mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-subtle">
        <span className="flex items-center gap-1.5">
          <Database size={12} />
          {indexUnknown
            ? "Checking index…"
            : manifest
              ? Object.entries(manifest.bySource)
                  .map(([kind, count]) => `${count} ${kind}`)
                  .join(" · ")
              : "Index not built yet — hit Rebuild."}
        </span>
        {!indexUnknown && (
          <span className="flex items-center gap-1.5">
            <GitCommitHorizontal size={12} />
            {status?.events ?? 0} events
          </span>
        )}
        {manifest && (
          <span>
            built {formatShortDate(Date.parse(manifest.builtAt))}
            {status?.stale ? (
              <span className="text-warning"> · stale, sources changed</span>
            ) : null}
          </span>
        )}
      </div>

      <SearchInput
        value={input}
        onChange={setInput}
        placeholder="What do I already know about…?"
        autoFocus
        isLoading={loading}
        wrapperClassName="mb-4"
      />

      <div className="card card-body mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-xs text-text-subtle">
          <span className="whitespace-nowrap">Budget</span>
          <input
            type="range"
            min={400}
            max={8000}
            step={200}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            aria-label="Token budget"
          />
          <span className="font-mono text-[11px] w-12 text-text">{budget}</span>
        </label>

        <label className="flex items-center gap-2 text-xs text-text-subtle">
          <span className="whitespace-nowrap">Keyword ↔ Vector</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={alpha}
            onChange={(e) => setAlpha(Number(e.target.value))}
            aria-label="Lexical to vector balance"
          />
          <span className="font-mono text-[11px] w-8 text-text">{alpha.toFixed(1)}</span>
        </label>

        <div className="flex items-center gap-1.5 flex-wrap">
          {RECALL_SOURCE_KINDS.map((kind) => {
            const active = kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className="badge"
                style={{
                  cursor: "pointer",
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-subtle)",
                  border: "1px solid var(--border)",
                }}
                aria-pressed={active}
              >
                {SOURCE_LABEL[kind]}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <FetchError message={error} onRetry={() => void run(input, { budget, alpha, kinds })} />
      ) : loading && !result ? (
        <LoadingLine message="Recalling…" />
      ) : !result ? (
        <EmptyState
          icon={<BrainCircuit size={32} />}
          title="Ask it something"
          subtitle="Whole questions rank better here than single keywords — this is not the ⌘K palette."
          action={
            <div className="flex flex-col gap-1.5 items-start">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="btn btn-ghost text-xs"
                  style={{ padding: "3px 10px" }}
                  onClick={() => setInput(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      ) : result.hits.length === 0 ? (
        <EmptyState
          icon={<BrainCircuit size={32} />}
          title={`Nothing recalled for "${result.query}"`}
          subtitle={
            result.corpusSize === 0
              ? "The index is empty. Rebuild it, then try again."
              : `Searched ${result.corpusSize} chunks. Try widening the source filters or nudging the slider toward Vector.`
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4 text-xs text-text-subtle">
            <span>
              <strong className="text-text">{result.hits.length}</strong> of {result.corpusSize} chunks
            </span>
            <span>
              <strong className="text-text">{result.totalTokens}</strong>/{result.budgetTokens} tokens
            </span>
            <span>{result.tookMs}ms</span>
            {result.truncated > 0 && <span>{result.truncated} over budget</span>}
            {result.duplicates > 0 && <span>{result.duplicates} near-duplicates hidden</span>}
          </div>

          {result.queryRefs.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-4 text-xs">
              <Sparkles size={12} className="text-accent" />
              <span className="text-text-subtle">Entities in query:</span>
              {result.queryRefs.map((ref) => (
                <span key={`${ref.kind}:${ref.id}`} className="badge badge-muted">
                  {ref.label}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {result.hits.map((hit) => {
              const isOpen = expanded.has(hit.chunk.id);
              return (
                <div key={hit.chunk.id} className="card" style={{ padding: 0 }}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(hit.chunk.id)}
                    className="w-full text-left flex items-start gap-3 p-3.5 bg-transparent border-0 cursor-pointer text-inherit"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="badge badge-muted">{SOURCE_LABEL[hit.chunk.sourceKind]}</span>
                        <span className="text-sm font-medium text-text truncate">{hit.chunk.title}</span>
                      </div>
                      <div className="text-[11px] text-accent mb-1 font-mono truncate">
                        {hit.chunk.sourceId}
                      </div>
                      <div className="text-xs text-text-muted line-clamp-2">{hit.snippet}</div>

                      <div className="flex items-center gap-3 mt-2 text-[10px] text-text-subtle">
                        <span
                          className="inline-block h-1 rounded"
                          style={{
                            width: scoreBar(hit.score, maxScore),
                            minWidth: "8px",
                            maxWidth: "80px",
                            background: "var(--accent)",
                          }}
                          aria-hidden
                        />
                        <span className="font-mono">{hit.score.toFixed(3)}</span>
                        <span>kw {hit.signals.lexical.toFixed(2)}</span>
                        <span>vec {hit.signals.vector.toFixed(2)}</span>
                        <span>rec {hit.signals.recency.toFixed(2)}</span>
                        {hit.signals.entity > 0 && (
                          <span className="text-accent">ent {hit.signals.entity.toFixed(2)}</span>
                        )}
                        <span>{hit.tokens} tok</span>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronDown size={14} className="text-text-subtle mt-1 shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-text-subtle mt-1 shrink-0" />
                    )}
                  </button>

                  {isOpen && (
                    <div
                      className="border-t px-3.5 py-3"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <pre className="text-xs whitespace-pre-wrap text-text-muted max-h-96 overflow-y-auto m-0 font-sans">
                        {hit.chunk.text}
                      </pre>
                      {hit.chunk.href && (
                        <div className="mt-3">
                          <Link
                            href={hit.chunk.href}
                            className="btn btn-ghost text-xs"
                            style={{ padding: "3px 8px" }}
                          >
                            Open source
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {result.relatedRefs.length > 0 && (
            <div className="card card-body mt-6 mb-2">
              <div className="text-xs text-text-subtle mb-2">
                Related entities — derived from co-occurrence, not hand-written links
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {result.relatedRefs.map((entry) => (
                  <span
                    key={`${entry.ref.kind}:${entry.ref.id}`}
                    className="badge badge-muted"
                    title={`weight ${entry.weight}`}
                  >
                    {entry.ref.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
