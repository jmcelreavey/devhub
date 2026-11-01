"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/lib/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { EmptyState, FetchError, LoadingLine } from "@/components";
import type { RecallSourceKind } from "../../../../packages/shared/ui-lib/recall/types";

interface RecallHit {
  chunk: {
    id: string;
    sourceKind: RecallSourceKind;
    title: string;
    text: string;
    href?: string;
    ts: number;
  };
  score: number;
  snippet: string;
}

interface RecallResponse {
  hits: RecallHit[];
  corpusSize: number;
}

const SOURCE_LABEL: Record<RecallSourceKind, string> = {
  note: "Note",
  learning: "Learning",
  doc: "Doc",
  task: "Tasks",
  event: "Event",
  diagram: "Diagram",
};

function relativeDate(ts: number): string {
  if (!ts) return "";
  const days = Math.round((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Semantic (Recall) results embedded in the unified search page. Hybrid
 * vector+lexical fusion with recency and entity priors — for when you
 * remember the topic, not the phrase.
 */
export function RecallResults({ query, onOpenRecall }: { query: string; onOpenRecall: () => void }) {
  const [result, setResult] = useState<(RecallResponse & { query: string }) | null>(null);
  const [loadingQuery, setLoadingQuery] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ query: string; message: string } | null>(null);
  const runRef = useRef(0);
  const activeQuery = query.trim();
  const hits = result?.query === activeQuery ? result.hits : null;
  const corpusSize = result?.query === activeQuery ? result.corpusSize : 0;
  const error = requestError?.query === activeQuery ? requestError.message : null;
  const loading = loadingQuery === activeQuery || (activeQuery !== "" && hits === null && !error);

  const run = useCallback(async (q: string, runId: number) => {
    if (runId !== runRef.current) return;
    setLoadingQuery(q);
    setRequestError(null);
    try {
      const params = new URLSearchParams({ q, limit: "20", alpha: "0.55" });
      const res = await fetch(`/api/recall?${params}`);
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Recall failed (${res.status})`);
      }
      const data = (await res.json()) as RecallResponse;
      if (runId !== runRef.current) return;
      setResult({ query: q, hits: data.hits ?? [], corpusSize: data.corpusSize ?? 0 });
    } catch (err) {
      if (runId !== runRef.current) return;
      setResult(null);
      setRequestError({ query: q, message: err instanceof Error ? err.message : "Recall failed" });
    } finally {
      if (runId === runRef.current) setLoadingQuery(null);
    }
  }, []);

  useEffect(() => {
    const runId = ++runRef.current;
    const t = setTimeout(() => {
      const q = query.trim();
      if (q) void run(q, runId);
    }, 350);
    return () => {
      clearTimeout(t);
      runRef.current += 1;
    };
  }, [query, run]);

  if (!query.trim()) {
    return (
      <EmptyState
        icon={<Sparkles size={36} />}
        title="Semantic search"
        subtitle="Ask by topic or meaning — hybrid vector + lexical ranking over notes, docs, tasks, learnings, diagrams, and your event spine. Exact phrase? Use the Exact tab."
      />
    );
  }

  if (loading && hits === null) return <LoadingLine message="Recalling…" />;
  if (error) return <FetchError message={error} onRetry={() => void run(activeQuery, ++runRef.current)} />;

  const maxScore = hits?.[0]?.score ?? 0;

  return (
    <>
      {loading ? <LoadingLine message="Recalling…" /> : null}
      {hits !== null && (
        <p className="text-xs mb-3 text-text-subtle">
          {hits.length} hit{hits.length !== 1 ? "s" : ""} across {corpusSize} indexed chunks
          {" · "}
          <button type="button" onClick={onOpenRecall} className="text-accent hover:underline inline-flex items-center gap-0.5">
            Full Recall <ArrowRight size={10} aria-hidden />
          </button>
        </p>
      )}
      {hits !== null && hits.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} />}
          title={`Nothing recalled for "${query}"`}
          subtitle="Try Exact mode for substring matches, or rebuild the index from the Recall page."
        />
      ) : null}
      <div className="space-y-2">
        {(hits ?? []).map((hit) => (
          <HitCard key={hit.chunk.id} hit={hit} maxScore={maxScore} />
        ))}
      </div>
    </>
  );
}

function HitCard({ hit, maxScore }: { hit: RecallHit; maxScore: number }) {
  const { chunk } = hit;
  const body = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="badge badge-muted shrink-0">{SOURCE_LABEL[chunk.sourceKind]}</span>
        <span className="text-sm font-medium truncate flex-1 min-w-0">{chunk.title}</span>
        {chunk.ts ? (
          <span className="shrink-0 text-[11px] text-text-subtle">{relativeDate(chunk.ts)}</span>
        ) : null}
      </div>
      <p className="text-xs text-text-muted line-clamp-2 m-0">{hit.snippet}</p>
      <div
        className="h-0.5 rounded-full"
        style={{
          width: `${maxScore > 0 ? Math.max(6, (hit.score / maxScore) * 100) : 6}%`,
          background: "var(--accent)",
          opacity: 0.55,
        }}
        aria-hidden
      />
    </>
  );
  const cls = "card card-body block py-2.5 hover:border-[var(--border)] transition-colors";
  return chunk.href ? (
    <Link href={chunk.href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
