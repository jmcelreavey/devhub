"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronUp, ClipboardCopy, Clock, Code2, Copy, FileText, Tag } from "lucide-react";
import { EmptyState, FetchError, ListFetchStates, LoadingLine, PageHeader, SearchInput } from "@/components";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatShortDate } from "@/lib/format-date";
import type { LearningDetail, LearningEntry } from "@/lib/learnings-types";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";

const icon = { size: 12 as const };

function LearningCard({
  entry,
  isOpen,
  onToggle,
  detail,
  detailLoading,
  detailError,
  onRetryDetail,
}: {
  entry: LearningEntry;
  isOpen: boolean;
  onToggle: () => void;
  detail: LearningDetail | undefined;
  detailLoading: boolean;
  detailError: Error | undefined;
  onRetryDetail: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<"row">();
  const href = `/notes/learnings/${entry.category}`;
  const groups: ContextMenuGroup[] = [
    {
      id: "open",
      items: [
        {
          id: "open",
          label: "Open",
          icon: <FileText {...icon} aria-hidden />,
          onSelect: () => router.push(href),
        },
        {
          id: "cursor",
          label: "Open in Cursor",
          icon: <Code2 {...icon} aria-hidden />,
          disabled: true,
          disabledReason: "Open in Cursor is for notes linked to a repo.",
          onSelect: () => undefined,
        },
      ],
    },
    {
      id: "file",
      items: [
        {
          id: "copy",
          label: "Copy path",
          icon: <ClipboardCopy {...icon} aria-hidden />,
          onSelect: () => {
            void copyTextToClipboard(`learnings/${entry.category}`).then(
              () => toast.success("Location copied"),
              () => toast.error("Could not copy to clipboard."),
            );
          },
        },
        {
          id: "markdown",
          label: "Copy as Markdown",
          icon: <Copy {...icon} aria-hidden />,
          onSelect: () => {
            void (async () => {
              const res = await fetch(`/api/learnings?category=${encodeURIComponent(entry.category)}`);
              const body = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
              if (!res.ok || typeof body.content !== "string") {
                throw new Error(body.error ?? res.statusText);
              }
              await copyTextToClipboard(body.content);
            })().then(
              () => toast.success("Markdown copied"),
              (err) => toast.error(err instanceof Error ? err.message : "Could not copy markdown."),
            );
          },
        },
      ],
    },
  ];

  return (
    <div className="card group" style={{ padding: 0 }} {...menu.bindRow("row")}>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          className="row-select min-w-0 flex-1 text-left flex items-center gap-3 p-4 bg-transparent border-0 cursor-pointer text-inherit"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--accent-dim)" }}>
            <Tag size={16} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium mb-0.5 text-text">{entry.title}</div>
            {entry.category.includes("/") && (
              <div className="text-[11px] mb-0.5 text-accent">{entry.category}</div>
            )}
            <div className="flex items-center gap-3 text-xs text-text-subtle">
              <span className="flex items-center gap-1"><FileText size={10} />{entry.lineCount} lines</span>
              <span className="flex items-center gap-1"><Clock size={10} />{formatShortDate(entry.modified)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-text-muted">
              <SimpleMarkdown text={entry.preview} compact />
            </div>
          </div>
          {isOpen ? <ChevronUp size={14} className="text-text-subtle" /> : <ChevronDown size={14} className="text-text-subtle" />}
        </button>
        <RowMenuKebab
          label={`Actions for ${entry.title}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      </div>

      {isOpen && (
        <div className="border-t px-4 py-4 max-h-[500px] overflow-y-auto" style={{ borderColor: "var(--border)" }}>
          {detailLoading ? (
            <LoadingLine message="Loading…" />
          ) : detailError ? (
            <FetchError message={detailError.message} onRetry={onRetryDetail} bare />
          ) : detail ? (
            <SimpleMarkdown text={detail.content} />
          ) : (
            <p className="text-xs text-text-subtle">Failed to load content.</p>
          )}
        </div>
      )}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${entry.title} actions`}
      />
    </div>
  );
}

export default function LearningsPage() {
  const { data, isLoading, error, mutate } = useLive<{ entries: LearningEntry[] }>("/api/learnings");
  const boot = useBootGate(data !== undefined || !!error);
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
      <BootScreen state={boot} />
      <PageHeader
        title="Learnings"
        subtitle={
          <>
            Distilled knowledge - <code className="text-[11px]">notes/learnings/</code>.{" "}
            <Link href="/notes" className="underline text-accent">Browse in Notes</Link>
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
              <LearningCard
                key={entry.category}
                entry={entry}
                isOpen={isOpen}
                onToggle={() => setExpanded(isOpen ? null : entry.category)}
                detail={isOpen ? detail : undefined}
                detailLoading={isOpen && detailLoading}
                detailError={isOpen ? detailError : undefined}
                onRetryDetail={() => void mutateDetail()}
              />
            );
          })}
        </div>
      </ListFetchStates>
    </div>
  );
}
