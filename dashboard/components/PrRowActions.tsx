"use client";

import type { ComponentType, MouseEvent } from "react";
import { CircleCheck, MessageSquare, ScanSearch } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { GithubPrRow } from "@/lib/github/prs";
import { buildSlackMessage, copyWithToast } from "@/lib/pr-slack";
import { agentReviewCommand, openTerminal } from "@/lib/terminal-launch";
import { notifyPrReviewNoteWatch, prReviewNotePath } from "@/lib/pr-review-notes";
import { buildPrNoteMarkdown, prEntityId, prNotePath } from "@/lib/pr-note";
import { EntityNoteAction } from "@/components/EntityNoteAction";
import { EntityLinkChips } from "@/components/EntityLinkChips";
import { PR_ACTION_BASE, PR_ACTION_SIZE, type PrActionSize } from "@/components/pr-row-action-style";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * One shared action row for a PR — Slack/Review plus the shared entity→note
 * FileText affordance (same EntityNoteAction as tasks/calendar).
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
  const notePath = prNotePath({ repo: row.repo, number: row.number });
  // Keep legacy path helper in sync for the agent CLI watch event.
  const watchPath = prReviewNotePath(row);

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
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
            title="Explain & review this PR with your agent CLI"
            size={size}
            onClick={async () => {
              openTerminal({
                label: `review ${row.repo}#${row.number}`,
                command: await agentReviewCommand(row.url, watchPath || notePath),
              });
              notifyPrReviewNoteWatch(row);
              toast.info("Reviewing in the terminal - a note link appears here when it's saved.");
            }}
          />
        )}

        {kind === "reviewed" && (
          <>
            <PrActionButton
              icon={CircleCheck}
              label="Copy approved"
              title="Copy a Slack “reviewed - approved” message"
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

        <EntityNoteAction
          path={notePath}
          markdown={buildPrNoteMarkdown({
            repo: row.repo,
            number: row.number,
            title: row.title,
            url: row.url,
          })}
          entityLabel={`${row.repo}#${row.number}`}
          variant={size === "sm" ? "icon" : "button"}
          errorMessage="Couldn't open PR note."
        />
      </div>
      <EntityLinkChips
        kind="pr"
        id={prEntityId(row)}
        label={`${row.repo}#${row.number}`}
        href={row.url}
        prRepo={row.repo}
        prNumber={row.number}
      />
    </div>
  );
}
