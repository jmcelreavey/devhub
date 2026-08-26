"use client";

import { Check, GitMerge } from "lucide-react";
import { useRouter } from "next/navigation";
import { prRowStatus } from "@/lib/github/pr-row-status";
import type { GithubPrRow } from "@/lib/github/prs";
import { extractTags } from "@/lib/entity-note";
import { PersonChip } from "@/components/PersonChip";
import { PrReviewNoteLink } from "@/components/PrReviewNoteLink";
import {
  buildPrRowMenuGroups,
  openPrRowNote,
  type PrRowKind,
} from "@/components/PrRowActions";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { useTagMenuGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";

export type { PrRowKind };

function PrStatusIcon({ row }: { row: GithubPrRow }) {
  const status = prRowStatus(row);
  if (status === "merged") {
    return (
      <span className="inline-flex shrink-0" title="Merged" aria-label="Merged" role="img">
        <GitMerge size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="inline-flex shrink-0" title="Approved" aria-label="Approved" role="img">
        <Check size={14} strokeWidth={2.5} style={{ color: "var(--success)" }} aria-hidden />
      </span>
    );
  }
  return null;
}

export function PrRow({
  row,
  kind,
  density = "compact",
}: {
  row: GithubPrRow;
  kind: PrRowKind;
  density?: "compact" | "comfortable";
}) {
  const toast = useToast();
  const router = useRouter();
  const menu = useContextMenu<GithubPrRow>();
  const compact = density === "compact";
  const avatarSize = compact ? 14 : 16;
  const target = menu.target ?? row;
  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "pr",
    id: `${target.repo}#${target.number}`,
    label: target.title,
    prRepo: target.repo,
    prNumber: target.number,
    extraTags: extractTags(target.title),
    enabled: menu.target !== null,
  });
  const groups = buildPrRowMenuGroups({
    row: target,
    kind,
    toast,
    openNote: () => openPrRowNote(row, (href) => router.push(href), toast),
    tagsGroup,
  });

  return (
    <div className="min-w-0">
      <div
        className={`pr-row group rounded ${compact ? "px-2 py-1.5" : "px-3 py-2.5"} transition-colors hover:bg-[var(--bg-muted)]`}
        {...menu.bindRow(row)}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`pr-row-title ${compact ? "text-sm" : "text-[15px]"}`}
            onContextMenu={(event) => event.preventDefault()}
          >
            {row.title}
          </a>
          <div className="pr-row-meta" data-pr-meta>
            <span className="pr-row-id">
              {row.repo}#{row.number}
            </span>
            {row.author ? (
              <>
                <span className="text-text-subtle" aria-hidden>
                  ·
                </span>
                <PersonChip
                  name={row.author.login}
                  email={`${row.author.login}@users.noreply.github.com`}
                  avatarUrl={row.author.avatarUrl}
                  size={avatarSize}
                />
              </>
            ) : null}
          </div>
        </div>
        <div className="pr-row-actions" data-pr-actions>
          <PrStatusIcon row={row} />
          <PrReviewNoteLink row={row} />
          <RowMenuKebab
            label={`Actions for ${row.repo}#${row.number}`}
            onOpen={(x, y) => menu.openAtPoint(x, y, row)}
          />
        </div>
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${row.repo}#${row.number} actions`}
      />
      {tagsModal}
    </div>
  );
}
