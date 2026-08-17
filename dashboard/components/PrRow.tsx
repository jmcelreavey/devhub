"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GithubPrRow } from "@/lib/github/prs";
import { PersonChip } from "@/components/PersonChip";
import { PrReviewNoteLink } from "@/components/PrReviewNoteLink";
import {
  buildPrRowMenuGroups,
  openPrRowNote,
  type PrRowKind,
} from "@/components/PrRowActions";
import { RequestReviewDialog, ReviewerFacepile } from "@/components/RequestReviewAction";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { useToast } from "@/lib/hooks/use-toast";

export type { PrRowKind };

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const compact = density === "compact";
  const avatarSize = compact ? 14 : 16;
  const groups = buildPrRowMenuGroups({
    row: menu.target ?? row,
    kind,
    toast,
    onRequestReview: () => setReviewOpen(true),
    openNote: () => openPrRowNote(row, (href) => router.push(href), toast),
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
            {(row.requestedReviewers?.length ?? 0) > 0 ? (
              <>
                <span className="text-text-subtle" aria-hidden>
                  ·
                </span>
                <ReviewerFacepile
                  reviewers={row.requestedReviewers ?? []}
                  size={avatarSize}
                  onClick={() => setReviewOpen(true)}
                />
              </>
            ) : null}
          </div>
        </div>
        <div className="pr-row-actions" data-pr-actions>
          <PrReviewNoteLink row={row} />
          <RowMenuKebab
            label={`Actions for ${row.repo}#${row.number}`}
            onOpen={(x, y) => menu.openAtPoint(x, y, row)}
          />
        </div>
      </div>
      {reviewOpen ? <RequestReviewDialog row={row} onClose={() => setReviewOpen(false)} /> : null}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${row.repo}#${row.number} actions`}
      />
    </div>
  );
}
