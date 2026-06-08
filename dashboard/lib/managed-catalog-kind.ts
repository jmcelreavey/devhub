/** Shared skill/agent catalog identifiers (client-safe). */

import type { CollectScript } from "./collect-import-client";

export type ManagedKind = "skill" | "agent";

export type AgentSourceFilter = "all" | "local";

export function itemKey(kind: ManagedKind, name: string): string {
  return `${kind}:${name}`;
}

export function catalogApiBase(kind: ManagedKind): string {
  return kind === "skill" ? "/api/skills" : "/api/agents";
}

export function localCandidatesApiPath(kind: ManagedKind): string {
  return kind === "skill" ? "/api/skills/local" : "/api/agents/local";
}

export function localContentApiPath(kind: ManagedKind, name: string): string {
  return `${localCandidatesApiPath(kind)}/${encodeURIComponent(name)}`;
}

export function catalogDisplayPrefix(kind: ManagedKind): string {
  return kind === "skill" ? "/" : "@";
}

export function sharedCatalogPathLabel(kind: ManagedKind): string {
  return kind === "skill" ? "skills/shared/" : "agents/shared/";
}

export function contentFileLabel(kind: ManagedKind, name: string): string {
  return kind === "skill" ? "SKILL.md" : `${name}.md`;
}

export function collectScriptForKind(kind: ManagedKind): CollectScript {
  return kind === "skill" ? "collect_local_skills" : "collect_local_agents";
}

export function collectImportBodyKey(
  kind: ManagedKind,
): "importSkillNames" | "importAgentNames" {
  return kind === "skill" ? "importSkillNames" : "importAgentNames";
}
