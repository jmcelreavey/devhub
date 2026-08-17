"use client";

import { ClipboardCopy, Code2, Copy, FileText, FlaskConical, RefreshCw } from "lucide-react";
import { FetchError, PageHeader } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ResearchCard {
  interest: string;
  title: string;
  summary: string;
  updatedAt?: string;
  sourcePath?: string;
  signals?: { title: string; url?: string }[];
}

interface ResearchPayload {
  script: string | null;
  researchDir: string;
  files: { name: string; mtimeMs: number; size: number }[];
  cards: ResearchCard[];
}

const icon = { size: 12 as const };

function researchNoteHref(sourcePath: string): string {
  const stem = sourcePath.replace(/\.md$/i, "");
  return `/notes/research/${stem}`;
}

function ResearchItem({ card }: { card: ResearchCard }) {
  const router = useRouter();
  const toast = useToast();
  const menu = useContextMenu<"row">();
  const path = card.sourcePath ? `research/${card.sourcePath}` : null;
  const groups: ContextMenuGroup[] = [
    {
      id: "open",
      items: [
        {
          id: "open",
          label: "Open",
          icon: <FileText {...icon} aria-hidden />,
          disabled: !card.sourcePath,
          disabledReason: card.sourcePath ? undefined : "This digest has no source file.",
          onSelect: () => {
            if (card.sourcePath) router.push(researchNoteHref(card.sourcePath));
          },
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
          disabled: !path,
          disabledReason: path ? undefined : "This digest has no source file.",
          onSelect: () => {
            if (!path) return;
            void copyTextToClipboard(path).then(
              () => toast.success("Location copied"),
              () => toast.error("Could not copy to clipboard."),
            );
          },
        },
        {
          id: "summary",
          label: "Copy summary",
          icon: <Copy {...icon} aria-hidden />,
          onSelect: () => {
            void copyTextToClipboard(card.summary).then(
              () => toast.success("Summary copied"),
              () => toast.error("Could not copy to clipboard."),
            );
          },
        },
      ],
    },
  ];

  return (
    <article className="card card-body group" {...menu.bindRow("row")}>
      <div className="mb-1 flex items-center gap-1.5">
        <div className="min-w-0 flex-1 flex items-center gap-1.5 text-sm font-semibold text-text">
          <FlaskConical size={13} aria-hidden />
          {card.title}
        </div>
        <RowMenuKebab
          label={`Actions for ${card.title}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      </div>
      {card.updatedAt ? (
        <div className="mb-2 text-[11px] text-text-muted">
          {new Date(card.updatedAt).toLocaleString()}
        </div>
      ) : null}
      <SimpleMarkdown text={card.summary} compact />
      {card.signals && card.signals.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-text-subtle">
          {card.signals.slice(0, 5).map((s) => (
            <li key={s.title}>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent"
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${card.title} actions`}
      />
    </article>
  );
}

export default function ResearchClient() {
  const { data, error, isLoading, mutate } = useLive<ResearchPayload>("/api/research", {
    refreshInterval: 0,
  });
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /**
   * Re-scans the research folder. There's no API trigger for the Last30Days
   * script itself yet — fresh digs are kicked off from Briefing.
   */
  async function rescanResearchDir() {
    setBusy(true);
    try {
      await mutate();
      toast.success("Research folder re-scanned — run Last30Days from Briefing for fresh digs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <PageHeader
        title="Research"
        subtitle="Last30Days / interest digests as a first-class Library tab."
        actions={
          <button type="button" className="btn btn-secondary text-xs" onClick={() => void rescanResearchDir()} disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
            Re-scan
          </button>
        }
      />

      {error ? (
        <FetchError message={error.message} onRetry={() => void mutate()} />
      ) : isLoading || !data ? (
        <div className="mt-4 space-y-3" aria-hidden>
          <div className="skeleton h-4 w-2/3" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="skeleton h-28 rounded-lg" />
            <div className="skeleton h-28 rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="text-xs text-text-subtle">
            Script: {data.script ? <code>{data.script}</code> : <em>not found — install last30days skill</em>}
            <span className="mx-2">·</span>
            Dir: <code>{data.researchDir}</code>
            <span className="mx-2">·</span>
            {data.files.length} files
          </div>

          {data.cards.length === 0 ? (
            <p className="text-xs text-text-subtle">
              No research cards yet. Add interests in Briefing prefs or drop markdown under{" "}
              <code>notes/research/</code>.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.cards.map((c) => (
                <ResearchItem key={c.sourcePath ?? c.title} card={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
