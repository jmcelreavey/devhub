/**
 * Build an EntityRef from the Link dialog kind + free-text value.
 * Shared by task.links PATCH and note ## Links upsert.
 */

import { parseJiraIssueKey, type EntityKind, type EntityRef } from "@/lib/entity-note";
export { parseJiraIssueKey };
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";
import {
  isDiagramStoragePath,
  stripDiagramsPrefix,
  toDiagramStoragePath,
} from "@/lib/diagram-utils";

/**
 * Vault-relative, no traversal. The result is persisted into note bodies and
 * later fed back to the server as a file path, so garbage in is a real problem.
 */
export function isSafeNotePath(value: string): boolean {
  if (!value || value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

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
    const id = parseJiraIssueKey(raw);
    if (!id) {
      throw new Error("Use a Jira issue key or browse URL like PTF-1234.");
    }
    const href = /^https?:\/\//i.test(raw) ? raw.split(/[?#]/)[0] : undefined;
    return href ? { kind: "jira", id, label: id, href } : { kind: "jira", id, label: id };
  }

  if (kind === "note") {
    const path = raw.replace(/^\/notes\//, "").replace(/\.json$/, "");
    if (!isSafeNotePath(path)) {
      throw new Error("Use a vault path like task-notes/2026-07-28-example.");
    }
    return {
      kind: "note",
      id: path,
      label: path.split("/").pop() || path,
      href: `/notes/${path.split("/").map(encodeURIComponent).join("/")}`,
    };
  }

  if (kind === "diagram") {
    let path = raw.replace(/^\/+/, "").replace(/\.json$/i, "");
    if (path.startsWith("notes/diagrams/")) path = path.slice("notes/".length);
    path = toDiagramStoragePath(path);
    if (!isDiagramStoragePath(path) || !isSafeNotePath(path)) {
      throw new Error("Use a diagram path like diagrams/Acme/Widget/overview.");
    }
    return {
      kind: "diagram",
      id: path,
      label: path.split("/").pop() || path,
      href: `/diagrams/${stripDiagramsPrefix(path)
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
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
    const isUrl = /^https?:\/\//i.test(raw);
    return {
      kind: "calendar",
      id: raw,
      label: "Calendar event",
      href: isUrl ? raw : "/calendar",
    };
  }

  if (kind === "task") {
    return { kind: "task", id: raw, label: raw, href: "/work?tab=tasks" };
  }

  // meeting / anything added to EntityKind later: keep the kind honest rather
  // than silently relabelling it a task.
  return { kind, id: raw, label: raw };
}
