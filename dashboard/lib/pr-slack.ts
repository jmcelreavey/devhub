import type { MouseEvent } from "react";
import type { GithubPrRow } from "@/lib/github/prs";
import type { useToast } from "@/lib/hooks/use-toast";
import { jiraBrowseUrl, jiraKeyFromText } from "./utils";
import { copyTextToClipboard } from "./clipboard";

export type SlackMessageKind = "awaiting" | "reviewed" | "reviewed-approved";

export function buildSlackMessage(row: GithubPrRow, kind: SlackMessageKind): string {
  const repo = row.repo.split("/").pop() ?? row.repo;
  const jiraKey = jiraKeyFromText(row.title);
  const jiraLine = jiraKey ? `JIRA: ${jiraBrowseUrl(jiraKey)}` : null;
  const lines: string[] = [];
  switch (kind) {
    case "awaiting":
      lines.push(`PR ready for \`${repo}\` - ${row.title}`);
      break;
    case "reviewed-approved":
      lines.push(`Reviewed \`${repo}\` - ${row.title} ✅`);
      break;
    case "reviewed":
      lines.push(`Reviewed \`${repo}\` - ${row.title}`);
      break;
  }
  lines.push(`PR: ${row.url}`);
  if (jiraLine) lines.push(jiraLine);
  return lines.join("\n");
}

export async function copyTextAndToast(
  text: string,
  label: string,
  toast: ReturnType<typeof useToast>,
): Promise<void> {
  try {
    await copyTextToClipboard(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error(`Couldn't copy ${label}.`);
  }
}

export function copyWithToast(text: string, label: string, toast: ReturnType<typeof useToast>) {
  return async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await copyTextAndToast(text, label, toast);
  };
}
