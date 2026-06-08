/**
 * Persona layer metadata for API and Persona tab UI.
 */

export type PersonaSourceId = "shared-persona" | "identity" | "deep-preferences";

export interface PersonaSourceMeta {
  id: PersonaSourceId;
  layer: "L0" | "L1" | "L2";
  loadLabel: string;
  syncLabel: string;
  tokenHint: string;
}

export const PERSONA_SOURCE_META: Record<PersonaSourceId, PersonaSourceMeta> = {
  identity: {
    id: "identity",
    layer: "L0",
    loadLabel: "Every message (keep tiny)",
    syncLabel: "Synced to all tools + repo AGENTS.md",
    tokenHint: "~200",
  },
  "shared-persona": {
    id: "shared-persona",
    layer: "L1",
    loadLabel: "Every session",
    syncLabel: "Synced to all tools + repo AGENTS.md",
    tokenHint: "~685",
  },
  "deep-preferences": {
    id: "deep-preferences",
    layer: "L2",
    loadLabel: "On demand via deep-preferences skill",
    syncLabel: "Not synced — repo + skill only",
    tokenHint: "~500 total (per-mode files are smaller)",
  },
};

/** Rough token estimate (chars / 4). */
export function estimatePersonaTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export const MARKER_START = "<!-- ai-dotfiles:shared-persona:start -->";
export const MARKER_END = "<!-- ai-dotfiles:shared-persona:end -->";
export const IDENTITY_MARKER_START = "<!-- ai-dotfiles:identity:start -->";
export const IDENTITY_MARKER_END = "<!-- ai-dotfiles:identity:end -->";

/** Extract payload between HTML comment markers. */
export function extractPersonaBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return null;
  const afterStart = startIdx + startMarker.length;
  const endIdx = content.indexOf(endMarker, afterStart);
  if (endIdx === -1) return null;
  let block = content.slice(afterStart, endIdx);
  if (block.startsWith("\n")) block = block.slice(1);
  if (block.endsWith("\n")) block = block.slice(0, -1);
  return block;
}
