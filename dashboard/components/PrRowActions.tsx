"use client";

import {
  CircleCheck,
  CircleSlash,
  Dumbbell,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2,
  MessageSquare,
  ScanSearch,
} from "lucide-react";
import { mutate as globalMutate } from "swr";
import type { GithubPrRow, GithubPrsApiPayload } from "@/lib/github/prs";
import { buildSlackMessage, copyTextAndToast } from "@/lib/pr-slack";
import { launchAgentJob } from "@/lib/agent-job";
import { agentReviewCommand, agentReviewPrompt } from "@/lib/terminal-launch";
import { notifyPrReviewNoteWatch, prReviewNotePath } from "@/lib/pr-review-notes";
import { buildPrNoteMarkdown, prNotePath } from "@/lib/pr-note";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { openPrInCursor } from "@/lib/open-in-cursor-client";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { ContextMenuGroup, ContextMenuItem } from "@/components/shell/ContextMenu";
import type { useToast } from "@/lib/hooks/use-toast";
import { jiraBrowseUrl, jiraKeyFromText } from "@/lib/utils";
import { withTagsGroup } from "@/lib/hooks/use-tag-menu";

export type PrRowKind = "authored" | "reviews" | "reviewed";

function copyUrlItems(
  row: GithubPrRow,
  toast: ReturnType<typeof useToast>,
): ContextMenuItem[] {
  const jiraKey = jiraKeyFromText(row.title);
  const items: ContextMenuItem[] = [
    {
      id: "copy-pr-url",
      label: "Copy PR URL",
      icon: <Link2 size={12} />,
      onSelect: () => void copyTextAndToast(row.url, "PR URL", toast),
    },
  ];
  if (jiraKey) {
    items.push({
      id: "copy-jira-url",
      label: "Copy Jira URL",
      description: jiraKey,
      icon: <Link2 size={12} />,
      onSelect: () => void copyTextAndToast(jiraBrowseUrl(jiraKey), "Jira URL", toast),
    });
  }
  return items;
}

export function buildPrRowMenuGroups({
  row,
  kind,
  toast,
  openNote,
  repLocked = false,
  openRep,
  tagsGroup = null,
}: {
  row: GithubPrRow;
  kind: PrRowKind;
  toast: ReturnType<typeof useToast>;
  openNote: () => void | Promise<void>;
  /** Today's unfinished daily rep is this PR — agent review stays locked until findings are saved. */
  repLocked?: boolean;
  openRep?: () => void;
  /** #tags on this PR (title + linked review note) — see useTagMenuGroup. */
  tagsGroup?: ContextMenuGroup | null;
}): ContextMenuGroup[] {
  const watchPath = prReviewNotePath(row);
  const notePath = prNotePath({ repo: row.repo, number: row.number });
  const openGithub = {
    id: "github",
    label: "Open on GitHub",
    icon: <ExternalLink size={12} />,
    onSelect: () => void openInBrowser(row.url),
  };
  const openCursor = {
    id: "cursor",
    label: "Open in Cursor",
    description: "Stash if dirty, check out this PR's branch",
    icon: <GitPullRequest size={12} />,
    onSelect: () => {
      void openPrInCursor(row.repo, row.number, toast);
    },
  };
  const noteItem = {
    id: "note",
    label: kind === "authored" ? "Open review note" : "Open note",
    icon: <FileText size={12} />,
    onSelect: () => void openNote(),
  };
  const agentReview = {
    id: "agent-review",
    label: "Review with agent",
    description: "Explain & review this PR (OpenCode or Agent tab)",
    icon: <ScanSearch size={12} />,
    onSelect: async () => {
      const note = watchPath || notePath;
      const result = await launchAgentJob({
        title: `Review PR #${row.number}`,
        kind: "review",
        repoName: row.repo,
        notePath: note,
        promptText: agentReviewPrompt(row.url, note),
        promptCommand: await agentReviewCommand(row.url, note),
        mode: "oneshot",
        reason: `PR review ${row.repo}#${row.number}`,
        alreadyConfirmed: true,
      });
      notifyPrReviewNoteWatch(row);
      toast.info(
        result.channel === "opencode"
          ? "Review running in OpenCode — note glyph appears here when saved."
          : "Review queued in the Agent tab — note glyph appears when saved.",
      );
    },
  };
  const repFirst = {
    id: "daily-rep-first",
    label: "Finish your daily rep first",
    description: "AI-free review before the agent gets a look",
    icon: <Dumbbell size={12} />,
    onSelect: () => openRep?.(),
  };
  const skipPr = {
    id: "skip-pr",
    label: "Skip until updated",
    description: "Hides this PR until someone pushes new commits",
    icon: <CircleSlash size={12} />,
    onSelect: async () => {
      const key = "/api/github/prs";
      // Optimistic: the refetch takes seconds (two gh searches), so drop the row
      // now and reconcile with the server in the background.
      await globalMutate<GithubPrsApiPayload>(
        key,
        (current) => (current ? { ...current, reviews: current.reviews.filter((r) => r.url !== row.url) } : current),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/github/prs/skip", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: row.url,
            updatedAt: row.updatedAt,
            repo: row.repo,
            number: row.number,
            title: row.title,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toast.info("Skipped — it comes back if the PR is updated.");
        // No revalidate on success. The row is already gone locally and the
        // server dropped its cache, so the next scheduled poll picks it up —
        // refetching per skip means two `gh` searches each time, which trips
        // GitHub's secondary rate limit when working through a review queue.
      } catch {
        toast.error("Couldn't skip PR.");
        void globalMutate(key);
      }
    },
  };

  if (kind === "authored") {
    return withTagsGroup(
      [
        {
          id: "authored",
          items: [
            openGithub,
            ...copyUrlItems(row, toast),
            openCursor,
            agentReview,
            {
              id: "slack-request",
              label: "Copy Slack request",
              icon: <MessageSquare size={12} />,
              onSelect: () => void copyTextAndToast(buildSlackMessage(row, "awaiting"), "Slack message", toast),
            },
            noteItem,
          ],
        },
      ],
      tagsGroup,
    );
  }

  if (kind === "reviews") {
    return withTagsGroup(
      [
        {
          id: "reviews",
          items: [
            repLocked ? repFirst : agentReview,
            openCursor,
            openGithub,
            ...copyUrlItems(row, toast),
            noteItem,
            skipPr,
          ],
        },
      ],
      tagsGroup,
    );
  }

  return withTagsGroup(
    [
      {
        id: "reviewed",
        items: [
          {
            id: "copy-approved",
            label: "Copy approved",
            icon: <CircleCheck size={12} />,
            onSelect: () =>
              void copyTextAndToast(buildSlackMessage(row, "reviewed-approved"), "Slack message", toast),
          },
          {
            id: "copy-reviewed",
            label: "Copy reviewed",
            icon: <MessageSquare size={12} />,
            onSelect: () => void copyTextAndToast(buildSlackMessage(row, "reviewed"), "Slack message", toast),
          },
          openCursor,
          openGithub,
          ...copyUrlItems(row, toast),
        ],
      },
    ],
    tagsGroup,
  );
}

export async function openPrRowNote(
  row: GithubPrRow,
  push: (href: string) => void,
  toast: ReturnType<typeof useToast>,
): Promise<void> {
  try {
    const result = await createOrOpenVaultNote({
      path: prNotePath({ repo: row.repo, number: row.number }),
      markdown: buildPrNoteMarkdown({
        repo: row.repo,
        number: row.number,
        title: row.title,
        url: row.url,
      }),
    });
    push(result.href);
  } catch {
    toast.error("Couldn't open PR note.");
  }
}
