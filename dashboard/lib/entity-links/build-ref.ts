/**
 * Build an EntityRef from the Link dialog kind + free-text value.
 * Shared by task.links PATCH and note ## Links upsert.
 */

import type { EntityKind, EntityRef } from "@/lib/entity-note";
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";

export function buildEntityRefFromInput(kind: EntityKind, rawInput: string): EntityRef {
  const raw = rawInput.trim();
  if (!raw) throw new Error("Enter a value to link.");

  if (kind === "pr") {
    const parsed = parseGithubPrUrl(raw) || parseGithubPrUrl(`https://github.com/${raw}`);
    if (!parsed && !raw.includes("#")) {
      throw new Error("Use a GitHub PR URL or owner/repo#123");
    }
    if (parsed) {
      return {
        kind: "pr",
        id: `${parsed.repo}#${parsed.number}`,
        label: `${parsed.repo}#${parsed.number}`,
        href: `https://github.com/${parsed.repo}/pull/${parsed.number}`,
      };
    }
    return { kind: "pr", id: raw, label: raw };
  }

  if (kind === "jira") {
    const id = raw.toUpperCase();
    return { kind: "jira", id, label: id };
  }

  if (kind === "note") {
    const path = raw.replace(/^\/notes\//, "").replace(/\.json$/, "");
    return {
      kind: "note",
      id: path,
      label: path.split("/").pop() || path,
      href: `/notes/${path.split("/").map(encodeURIComponent).join("/")}`,
    };
  }

  if (kind === "repo") {
    const name = raw.replace(/^repo:/, "");
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new Error("Choose a local repository.");
    }
    return { kind: "repo", id: name, label: name };
  }

  if (kind === "calendar") {
    if (raw.startsWith("http")) {
      return {
        kind: "calendar",
        id: raw,
        label: "Calendar event",
        href: raw,
      };
    }
    return {
      kind: "calendar",
      id: raw,
      label: "Calendar event",
      href: "/calendar",
    };
  }

  return { kind: "task", id: raw, label: raw, href: "/work?tab=tasks" };
}
