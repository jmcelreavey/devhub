"use client";

import { useRouter } from "next/navigation";
import type { GithubPrRow } from "@/lib/github/prs";
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
import { useToast } from "@/lib/hooks/use-toast";
import { useTodayRep } from "@/lib/hooks/use-today-rep";

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
  const { data: repData } = useTodayRep();
  const compact = density === "compact";
  const avatarSize = compact ? 14 : 16;
  const target = menu.target ?? row;
  const repLocked =
    kind === "reviews" &&
    !!repData?.rep?.pr &&
    !repData.rep.completedAt &&
    repData.rep.pr.repo === target.repo &&
    repData.rep.pr.number === target.number;
  const groups = buildPrRowMenuGroups({
    row: target,
    kind,
    toast,
    openNote: () => openPrRowNote(row, (href) => router.push(href), toast),
    repLocked,
    openRep: () => router.push("/review/rep"),
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
    </div>
  );
}
