"use client";

import type { ComponentType, MouseEvent } from "react";
import { CircleCheck, MessageSquare, ScanSearch } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { GithubPrRow } from "@/lib/github-prs";
import { buildSlackMessage, copyWithToast } from "@/lib/pr-slack";
import { opencodeReviewCommand, openTerminal } from "@/lib/terminal-launch";
import { notifyPrReviewNoteWatch, prReviewNotePath } from "@/lib/pr-review-notes";
import { PrReviewNoteLink } from "@/components/PrReviewNoteLink";
import { PR_ACTION_BASE, PR_ACTION_SIZE, type PrActionSize } from "@/components/pr-row-action-style";
import { useToast } from "@/lib/use-toast";

/**
 * One shared action row for a PR, used by both the dashboard panel and the
 * /prs page so the buttons stay identical in icon, colour, sizing and wording.
 *
 * - authored → Copy Slack "ready for review" message
 * - reviews  → Review (kicks off an OpenCode explain + review in the terminal)
 * - reviewed → Copy "reviewed — approved" / "reviewed" messages
 *
 * Every action is an accent (blue) icon + label. `size` switches between the
 * compact dashboard rows and the roomier /prs cards.
 */
export type PrRowKind = "authored" | "reviews" | "reviewed";

function PrActionButton({
  icon: Icon,
  label,
  title,
  size,
  onClick,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  title: string;
  size: PrActionSize;
  onClick: (e: MouseEvent) => void;
}) {
  const s = PR_ACTION_SIZE[size];
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={`${PR_ACTION_BASE} ${s.btn}`}>
      <Icon size={s.icon} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function PrRowActions({
  row,
  kind,
  size = "md",
}: {
  row: GithubPrRow;
  kind: PrRowKind;
  size?: PrActionSize;
}) {
  const toast = useToast();

  return (
    <>
      {kind === "authored" && (
        <PrActionButton
          icon={MessageSquare}
          label="Copy request"
          title="Copy a Slack message asking for review"
          size={size}
          onClick={copyWithToast(buildSlackMessage(row, "awaiting"), "Slack message", toast)}
        />
      )}

      {kind === "reviews" && (
        <PrActionButton
          icon={ScanSearch}
          label="Review"
          title="Explain & review this PR with OpenCode"
          size={size}
          onClick={() => {
            openTerminal({
              label: `review ${row.repo}#${row.number}`,
              command: opencodeReviewCommand(row.url, prReviewNotePath(row)),
            });
            notifyPrReviewNoteWatch(row);
            toast.info("Reviewing in the terminal — a note link appears here when it's saved.");
          }}
        />
      )}

      {kind === "reviewed" && (
        <>
          <PrActionButton
            icon={CircleCheck}
            label="Copy approved"
            title="Copy a Slack “reviewed — approved” message"
            size={size}
            onClick={copyWithToast(buildSlackMessage(row, "reviewed-approved"), "Slack message", toast)}
          />
          <PrActionButton
            icon={MessageSquare}
            label="Copy reviewed"
            title="Copy a Slack “reviewed” message"
            size={size}
            onClick={copyWithToast(buildSlackMessage(row, "reviewed"), "Slack message", toast)}
          />
        </>
      )}

      <PrReviewNoteLink row={row} size={size} />
    </>
  );
}
