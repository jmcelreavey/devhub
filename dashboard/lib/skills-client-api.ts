/**
 * Browser-side helpers for Skills page API calls.
 */
import type {
  RefreshAiToolsResponse,
  SkillListItem,
  SkillsListResponse,
} from "./skills-api-types";

export async function fetchSkillsCatalog(): Promise<SkillsListResponse> {
  const r = await fetch("/api/skills");
  if (!r.ok) throw new Error("Failed to load skills");
  const data = (await r.json()) as SkillsListResponse | SkillListItem[];
  if (Array.isArray(data)) {
    return {
      skills: data,
      aiTools: { available: false, path: null, root: "", syncEnabled: true },
    };
  }
  return data;
}

export async function refreshAiToolsCheckout(): Promise<RefreshAiToolsResponse> {
  const r = await fetch("/api/skills/refresh-ai-tools", { method: "POST" });
  if (!r.ok) throw new Error("Failed to refresh ai-tools");
  return r.json() as Promise<RefreshAiToolsResponse>;
}
