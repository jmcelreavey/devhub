"use client";

import { Check, CheckCircle2, CircleDot, GitMerge, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { prRowStatus } from "@/lib/github/pr-row-status";
import type { GithubPrRow } from "@/lib/github/prs";
import type { PrChecksState } from "@/lib/github/branch-pr";
import { PersonChip } from "@/components/PersonChip";
import { PrReviewNoteLink } from "@/components/PrReviewNoteLink";
import { usePrStatusMenu, type PrStatusPillBind } from "@/components/github/PrStatusMenu";
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


const CHECK_ICON: Record<Exclude<PrChecksState, "none">, typeof CheckCircle2> = {
  passing: CheckCircle2,
  failing: XCircle,
  pending: CircleDot,
};

/** Rolled-up CI state — same visual language as RepoOpenPrLink. */
function PrChecksGlance({ row, bind }: { row: GithubPrRow; bind: PrStatusPillBind }) {
  const state = row.checks ?? "none";
  if (state === "none") return null;
  const Icon = CHECK_ICON[state];
  const counts = row.checkCounts;
  const title = counts
    ? `checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.pending} pending`
    : `checks ${state}`;
  return (
    <span
      className="pr-row-checks"
      data-checks={state}
      title={title}
      aria-label={`checks ${state}`}
      role="img"
      tabIndex={0}
      {...bind}
    >
      <Icon size={14} aria-hidden />
    </span>
  );
}

function PrStatusIcon({ row, bind }: { row: GithubPrRow; bind: PrStatusPillBind }) {
  const status = prRowStatus(row);
  if (status === "merged") {
    return (
      <span className="inline-flex shrink-0" title="Merged" aria-label="Merged" role="img" tabIndex={0} {...bind}>
        <GitMerge size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="inline-flex shrink-0" title="Approved" aria-label="Approved" role="img" tabIndex={0} {...bind}>
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
  const statusMenu = usePrStatusMenu({
    url: row.url,
    repo: row.repo,
    number: row.number,
    checks: row.checks ?? null,
    checkCounts: row.checkCounts ?? null,
  });
  const compact = density === "compact";
  const avatarSize = compact ? 14 : 16;
  const target = menu.target ?? row;
  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "pr",
    id: `${target.repo}#${target.number}`,
    label: target.title,
    prRepo: target.repo,
    prNumber: target.number,
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
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const host = (event.currentTarget as HTMLElement).closest(
                "[data-context-menu-host]",
              ) as HTMLElement | null;
              menu.openAtPoint(event.clientX, event.clientY, row, host);
            }}
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
          {row.draft ? (
            <span className="pr-status-pill" tabIndex={0} {...statusMenu.bind}>
              Draft
            </span>
          ) : null}
          <PrChecksGlance row={row} bind={statusMenu.bind} />
          <PrStatusIcon row={row} bind={statusMenu.bind} />
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
      {statusMenu.menuNode}
      {tagsModal}
    </div>
  );
}
