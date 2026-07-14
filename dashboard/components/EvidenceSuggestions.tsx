"use client";

import { useState, type ReactNode } from "react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { recordAppraisalEvidence } from "@/lib/appraisal-record";
import { useToast } from "@/lib/use-toast";

/** A PR / Jira / Datadog artifact suggested as appraisal evidence (see /api/appraisal/evidence). */
export interface EvidenceSuggestion {
  kind: string;
  title: string;
  url: string;
  summary: string;
  suggestedTheme: string;
  date: string;
}

export interface EvidenceSaveResult {
  created: boolean;
  slug: string;
  path: string;
  warning?: string | null;
}

interface EvidenceSuggestionListProps {
  suggestions: EvidenceSuggestion[];
  isLoading?: boolean;
  emptyMessage: string;
  /** Cap on rendered suggestions. */
  max?: number;
  /** Extra per-row actions rendered next to Save (e.g. appraisal's Cite button). */
  renderExtraActions?: (s: EvidenceSuggestion) => ReactNode;
  /** Called after a successful Save (appraisal uses this to refresh / jump year). */
  onSaved?: (s: EvidenceSuggestion, result: EvidenceSaveResult) => void;
  /** Show a "Save all visible" control above the list. */
  showSaveAll?: boolean;
}

/**
 * Shared "suggested evidence" rows used by /appraisal and /one-on-one:
 * title link + kind/theme badges + summary, with a Save button that records
 * the artifact into the appraisal year note.
 */
export function EvidenceSuggestionList({
  suggestions,
  isLoading = false,
  emptyMessage,
  max = 12,
  renderExtraActions,
  onSaved,
  showSaveAll = false,
}: EvidenceSuggestionListProps) {
  const toast = useToast();
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const visible = suggestions.slice(0, max);

  async function save(s: EvidenceSuggestion) {
    setSavingUrl(s.url);
    try {
      const result = await recordAppraisalEvidence({
        title: s.title,
        theme: s.suggestedTheme,
        summary: s.summary,
        url: s.url,
        date: s.date,
        kind: s.kind,
      });
      toast.success(result.created ? `Recorded ${result.slug}` : `Updated ${result.slug}`);
      onSaved?.(s, result);
      return result;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record");
      return null;
    } finally {
      setSavingUrl(null);
    }
  }

  async function saveAll() {
    if (visible.length === 0 || savingAll) return;
    setSavingAll(true);
    let ok = 0;
    try {
      for (const s of visible) {
        const result = await recordAppraisalEvidence({
          title: s.title,
          theme: s.suggestedTheme,
          summary: s.summary,
          url: s.url,
          date: s.date,
          kind: s.kind,
        });
        ok += 1;
        onSaved?.(s, result);
      }
      toast.success(`Saved ${ok} candidate${ok === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(
        ok > 0
          ? `Saved ${ok}, then failed: ${e instanceof Error ? e.message : "error"}`
          : e instanceof Error
            ? e.message
            : "Could not record",
      );
    } finally {
      setSavingAll(false);
    }
  }

  if (isLoading) return <SkeletonRows count={4} height={44} variant="list" />;
  if (suggestions.length === 0) return <p>{emptyMessage}</p>;

  return (
    <>
      {showSaveAll ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="btn btn-secondary text-[11px]"
            disabled={savingAll || visible.length === 0}
            onClick={() => void saveAll()}
          >
            {savingAll ? "Saving…" : `Save all visible (${visible.length})`}
          </button>
        </div>
      ) : null}
      {visible.map((s) => (
        <div key={`${s.kind}:${s.url}`} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent">
              {s.title}
            </a>
            <span className="ml-1.5 badge badge-muted">{s.kind}</span>
            <span className="ml-1 badge badge-muted">{s.suggestedTheme}</span>
            <p className="mt-0.5 line-clamp-2">{s.summary}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="btn btn-primary text-[11px]"
              disabled={savingUrl === s.url || savingAll}
              onClick={() => void save(s)}
            >
              {savingUrl === s.url ? "Saving…" : "Save"}
            </button>
            {renderExtraActions?.(s)}
          </div>
        </div>
      ))}
    </>
  );
}
