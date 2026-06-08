"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronUp, Clock, FileText, Tag } from "lucide-react";
import { EmptyState, FetchError, ListFetchStates, LoadingLine, PageHeader, SearchInput } from "@/components";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { formatShortDate } from "@/lib/format-date";
import type { LearningDetail, LearningEntry } from "@/lib/learnings-types";
import { useLive } from "@/lib/use-fetch";

export default function LearningsPage() {
  const { data, isLoading, error, mutate } = useLive<{ entries: LearningEntry[] }>("/api/learnings");
  const entries = data?.entries ?? [];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const detailKey = expanded ? `/api/learnings?category=${encodeURIComponent(expanded)}` : null;
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    mutate: mutateDetail,
  } = useLive<LearningDetail>(detailKey);

  const filtered = search
    ? entries.filter(
        (e) =>
          e.category.toLowerCase().includes(search.toLowerCase()) ||
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          e.preview.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Learnings"
        subtitle={
          <>
            Distilled knowledge — <code className="text-[11px]">notes/learnings/</code>.{" "}
            <Link href="/notes" className="underline" style={{ color: "var(--accent)" }}>Browse in Notes</Link>
          </>
        }
        badge={<span className="badge badge-muted">{entries.length}</span>}
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Filter learnings..." />

      <ListFetchStates
        loading={isLoading}
        error={error?.message}
        onRetry={() => void mutate()}
        isEmpty={filtered.length === 0}
        loadingMessage="Loading learnings…"
        empty={
          <EmptyState
            icon={<BookOpen size={32} />}
            title={search ? `No learnings matching "${search}"` : "No learnings yet"}
          />
        }
      >
        <div className="flex flex-col gap-1">
          {filtered.map((entry) => {
            const isOpen = expanded === entry.category;
            return (
              <div key={entry.category} className="card" style={{ padding: 0 }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : entry.category)}
                  className="w-full text-left flex items-center gap-3 p-4 bg-transparent border-0 cursor-pointer text-inherit"
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--accent-dim)" }}>
                    <Tag size={16} style={{ color: "var(--accent)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium mb-0.5" style={{ color: "var(--text)" }}>{entry.title}</div>
                    {entry.category.includes("/") && (
                      <div className="text-[11px] mb-0.5" style={{ color: "var(--accent)" }}>{entry.category}</div>
                    )}
                    <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-subtle)" }}>
                      <span className="flex items-center gap-1"><FileText size={10} />{entry.lineCount} lines</span>
                      <span className="flex items-center gap-1"><Clock size={10} />{formatShortDate(entry.modified)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      <SimpleMarkdown text={entry.preview} compact />
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={14} style={{ color: "var(--text-subtle)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-subtle)" }} />}
                </button>

                {isOpen && (
                  <div className="border-t px-4 py-4 max-h-[500px] overflow-y-auto" style={{ borderColor: "var(--border)" }}>
                    {detailLoading ? (
                      <LoadingLine message="Loading…" />
                    ) : detailError ? (
                      <FetchError message={detailError.message} onRetry={() => void mutateDetail()} />
                    ) : detail ? (
                      <>
                        <div className="flex justify-end mb-3">
                          <Link href={`/notes/learnings/${detail.category}`} className="btn btn-ghost text-xs" style={{ padding: "4px 8px" }}>
                            Open in editor
                          </Link>
                        </div>
                        <SimpleMarkdown text={detail.content} />
                      </>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Failed to load content.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ListFetchStates>
    </div>
  );
}
