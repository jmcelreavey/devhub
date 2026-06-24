import type { MouseEvent } from "react";
import type { GithubPrRow } from "./github-prs";
import type { useToast } from "./use-toast";
import { JIRA_KEY_RE } from "./utils";

export type SlackMessageKind = "awaiting" | "reviewed" | "reviewed-approved";

const DEFAULT_JIRA_DOMAIN = "your-domain.atlassian.net";

function getJiraDomain(): string {
  return process.env.NEXT_PUBLIC_JIRA_DOMAIN?.trim() || DEFAULT_JIRA_DOMAIN;
}

export function buildSlackMessage(row: GithubPrRow, kind: SlackMessageKind): string {
  const repo = row.repo.split("/").pop() ?? row.repo;
  const jiraKey = row.title.match(JIRA_KEY_RE)?.[1];
  const jiraLine = jiraKey ? `JIRA: https://${getJiraDomain()}/browse/${jiraKey}` : null;
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

export function copyWithToast(text: string, label: string, toast: ReturnType<typeof useToast>) {
  return async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Copy failed.");
    }
  };
}
