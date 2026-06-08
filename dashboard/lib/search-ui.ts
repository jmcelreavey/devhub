import type { LucideIcon } from "lucide-react";
import { FileText, PenTool } from "lucide-react";
import { isDiagramStoragePath, toDiagramRoutePath } from "@/lib/diagram-utils";

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchFileGroup {
  path: string;
  matches: SearchMatch[];
  score: number;
}

export interface SearchCategory {
  label: string;
  icon: LucideIcon;
  color: string;
}

export function searchFileHref(path: string): string {
  return isDiagramStoragePath(path)
    ? toDiagramRoutePath(path)
    : `/notes/${path.replace(/\.json$/, "")}`;
}

export function searchCategoryFromPath(path: string): SearchCategory {
  if (isDiagramStoragePath(path)) return { label: "Diagram", icon: PenTool, color: "var(--accent)" };
  if (path.includes("learnings")) return { label: "Learning", icon: FileText, color: "var(--success)" };
  if (path.includes("daily")) return { label: "Daily", icon: FileText, color: "var(--accent)" };
  if (path.includes("sessions")) return { label: "Session", icon: FileText, color: "#bc8cff" };
  if (path.includes("inbox")) return { label: "Inbox", icon: FileText, color: "var(--text-muted)" };
  return { label: "Note", icon: FileText, color: "var(--text-subtle)" };
}

export function findHighlightRange(text: string, query: string): { start: number; end: number } | null {
  if (!query.trim()) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { start: idx, end: idx + query.length };
}

export type SearchMode = "exact" | "semantic" | "auto";

export function shouldUseSemanticSearch(query: string): boolean {
  return query.trim().split(/\s+/).length >= 2;
}

export function resolveSearchMode(query: string, preference: SearchMode): "exact" | "semantic" {
  if (preference === "semantic") return "semantic";
  if (preference === "exact") return "exact";
  return shouldUseSemanticSearch(query) ? "semantic" : "exact";
}

export function buildSearchUrl(
  query: string,
  options?: { mode?: SearchMode; vault?: string },
): string {
  const params = new URLSearchParams({ q: query });
  if (options?.vault) params.set("vault", options.vault);
  const mode = resolveSearchMode(query, options?.mode ?? "exact");
  if (mode === "semantic") params.set("mode", "semantic");
  return `/api/search?${params.toString()}`;
}
