"use client";

import type { ContextMenuGroup,ContextMenuItem } from "@/components/shell/ContextMenu";
import { launchAgentJob } from "@/lib/agent-job";
import { vaultNoteApi, vaultNoteHref } from "@/lib/create-vault-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { GithubPrRow,GithubPrsApiPayload } from "@/lib/github/prs";
import { withTagsGroup } from "@/lib/hooks/use-tag-menu";
import type { useToast } from "@/lib/hooks/use-toast";
import { openPrInCursor } from "@/lib/open-in-cursor-client";
import { prNotePath } from "@/lib/pr-note";
import { openNoteHrefInPanel } from "@/lib/notes/open-in-panel";
import { notifyPrReviewNoteWatch,prReviewNotePath } from "@/lib/pr-review-notes";
import { buildSlackMessage,copyTextAndToast } from "@/lib/pr-slack";
import {
agentPipelineInvestigatePrompt,
agentReviewPrompt,
agentReviewSessionTitle,
} from "@/lib/terminal-launch";
import { jiraBrowseUrl,jiraKeyFromText } from "@/lib/utils";
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
Wrench,
} from "lucide-react";
import { mutate as globalMutate } from "swr";
import { isGithubPrsListKey } from "@/lib/github/prs-swr";

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

function groupPrActions(items: ContextMenuItem[]): ContextMenuGroup[] {
  const sections = [
    { id: "review", label: "Review", ids: ["daily-rep-first", "agent-review", "investigate-pipeline"] },
    { id: "open", label: "Open", ids: ["github", "cursor", "note"] },
    { id: "share", label: "Copy and share", ids: ["copy-approved", "copy-reviewed", "copy-pr-url", "copy-jira-url", "slack-request"] },
    { id: "visibility", label: "Visibility", ids: ["skip-pr"] },
  ];
  return sections.map(({ id, label, ids }) => ({
    id,
    label,
    items: items.filter((item) => ids.includes(item.id)),
  })).filter((group) => group.items.length > 0);
}

export function buildPrRowMenuGroups({
  row,
  kind,
  toast,
  openNote,
  repLocked = false,
  canSkip = true,
  openRep,
  tagsGroup = null,
}: {
  row: GithubPrRow;
  kind: PrRowKind;
  toast: ReturnType<typeof useToast>;
  openNote: () => void | Promise<void>;
  /** Today's unfinished daily rep is this PR — agent review stays locked until findings are saved. */
  repLocked?: boolean;
  canSkip?: boolean;
  openRep?: () => void;
  /** Linked entities on this PR — see useTagMenuGroup. */
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
    description: "Explain and review this PR in Agents",
    icon: <ScanSearch size={12} />,
    onSelect: async () => {
      const note = watchPath || notePath;
      const title = agentReviewSessionTitle(row);
      await launchAgentJob({
        title,
        kind: "review",
        repoName: row.repo,
        notePath: note,
        promptText: agentReviewPrompt(row.url, note, title),
        prUrl: row.url,
        mode: "oneshot",
        reason: `PR review ${row.repo}#${row.number}`,
        alreadyConfirmed: true,
      });
      notifyPrReviewNoteWatch(row);

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
    description: "Hides this PR until something changes on it",
    icon: <CircleSlash size={12} />,
    onSelect: async () => {
      const key = isGithubPrsListKey;
      // Optimistic: the refetch takes seconds (two gh searches), so drop the row
      // now and reconcile with the server in the background.
      await globalMutate<GithubPrsApiPayload>(
        key,
        (current) =>
          current
            ? {
                ...current,
                authored: current.authored.filter((r) => r.url !== row.url),
                reviews: current.reviews.filter((r) => r.url !== row.url),
              }
            : current,
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
            kind: kind === "authored" ? "authored" : "reviews",
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toast.info("Skipped — it comes back if the PR is updated.");
        void globalMutate("/api/github/prs/skip");
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


  const investigatePipeline = {
    id: "investigate-pipeline",
    label: "Investigate pipeline",
    description: "Inspect CI checks; confirm before fixing",
    icon: <Wrench size={12} />,
    onSelect: async () => {
      const note = watchPath || notePath;
      await launchAgentJob({
        title: `Pipeline PR #${row.number}`,
        kind: "agent",
        repoName: row.repo,
        notePath: note,
        promptText: agentPipelineInvestigatePrompt(row.url, note),
        prUrl: row.url,
        mode: "oneshot",
        reason: `Pipeline investigate ${row.repo}#${row.number}`,
        alreadyConfirmed: true,
      });
      notifyPrReviewNoteWatch(row);

    },
  };

  if (kind === "authored") {
    return withTagsGroup(
      groupPrActions([
        openGithub,
        ...copyUrlItems(row, toast),
        openCursor,
        agentReview,
        investigatePipeline,
        {
          id: "slack-request",
          label: "Copy Slack request",
          icon: <MessageSquare size={12} />,
          onSelect: () => void copyTextAndToast(buildSlackMessage(row, "awaiting"), "Slack message", toast),
        },
        noteItem,
        ...(canSkip ? [skipPr] : []),
      ]),
      tagsGroup,
    );
  }

  if (kind === "reviews") {
    return withTagsGroup(
      groupPrActions([
        repLocked ? repFirst : agentReview,
        investigatePipeline,
        openCursor,
        openGithub,
        ...copyUrlItems(row, toast),
        noteItem,
        ...(canSkip ? [skipPr] : []),
      ]),
      tagsGroup,
    );
  }

  return withTagsGroup(
    groupPrActions([
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
    ]),
    tagsGroup,
  );
}

export async function openPrRowNote(
  row: GithubPrRow,
  push: (href: string) => void,
  toast: ReturnType<typeof useToast>,
): Promise<void> {
  try {
    const path = prNotePath({ repo: row.repo, number: row.number });
    const response = await fetch(vaultNoteApi(path), { cache: "no-store" });
    if (response.status === 404) {
      toast.info("No saved PR note yet. Use Review with agent to create one.");
      return;
    }
    if (!response.ok) throw new Error("Couldn't load PR note.");
    const href = vaultNoteHref(path);
    if (!openNoteHrefInPanel(href)) push(href);
  } catch {
    toast.error("Couldn't open PR note.");
  }
}
