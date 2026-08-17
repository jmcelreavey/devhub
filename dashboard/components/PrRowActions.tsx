"use client";

import {
  CircleCheck,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2,
  MessageSquare,
  ScanSearch,
  UserPlus,
} from "lucide-react";
import type { GithubPrRow } from "@/lib/github/prs";
import { buildSlackMessage, copyTextAndToast } from "@/lib/pr-slack";
import { agentReviewCommand, openTerminal } from "@/lib/terminal-launch";
import { notifyPrReviewNoteWatch, prReviewNotePath } from "@/lib/pr-review-notes";
import { buildPrNoteMarkdown, prNotePath } from "@/lib/pr-note";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { openPrInCursor } from "@/lib/open-in-cursor-client";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { ContextMenuGroup, ContextMenuItem } from "@/components/shell/ContextMenu";
import type { useToast } from "@/lib/hooks/use-toast";
import { jiraBrowseUrl, jiraKeyFromText } from "@/lib/utils";

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
  onRequestReview,
}: {
  row: GithubPrRow;
  kind: PrRowKind;
  toast: ReturnType<typeof useToast>;
  openNote: () => void | Promise<void>;
  onRequestReview?: () => void;
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

  if (kind === "authored") {
    return [
      {
        id: "authored",
        items: [
          openGithub,
          ...copyUrlItems(row, toast),
          openCursor,
          {
            id: "request-review",
            label: "Request review…",
            icon: <UserPlus size={12} />,
            onSelect: () => onRequestReview?.(),
          },
          {
            id: "slack-request",
            label: "Copy Slack request",
            icon: <MessageSquare size={12} />,
            onSelect: () => void copyTextAndToast(buildSlackMessage(row, "awaiting"), "Slack message", toast),
          },
          noteItem,
        ],
      },
    ];
  }

  if (kind === "reviews") {
    return [
      {
        id: "reviews",
        items: [
          {
            id: "agent-review",
            label: "Review with agent",
            description: "Explain & review this PR in the terminal",
            icon: <ScanSearch size={12} />,
            onSelect: async () => {
              openTerminal({
                label: `review ${row.repo}#${row.number}`,
                command: await agentReviewCommand(row.url, watchPath || notePath),
              });
              notifyPrReviewNoteWatch(row);
              toast.info("Reviewing in the terminal — a note glyph appears here when it's saved.");
            },
          },
          openCursor,
          openGithub,
          ...copyUrlItems(row, toast),
          noteItem,
        ],
      },
    ];
  }

  return [
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
  ];
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
