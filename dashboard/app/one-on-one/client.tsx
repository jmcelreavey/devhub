"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, FilePlus2, Target, Users } from "lucide-react";
import { PageHeader, SkeletonRows } from "@/components";
import { ToggleGroup } from "@/components/ToggleGroup";
import {
  EvidenceSuggestionList,
  type EvidenceSuggestion,
} from "@/components/EvidenceSuggestions";
import {
  EVIDENCE_RANGE_PRESETS,
  evidenceRangeLabel,
  type EvidenceRangeDays,
} from "@/lib/appraisal-evidence-range";
import { useEvidenceRangeDays } from "@/lib/use-evidence-range-days";
import { useLive } from "@/lib/use-fetch";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/use-toast";
import { textToBlocks } from "@/lib/markdown-convert";
import { insertUnderHeading } from "@/lib/one-on-one-template";

const TEMPLATE_STORAGE_KEY = "devhub:one-on-one-template";

const DEFAULT_TEMPLATE = `# 1:1 — {{date}}

## Wins / shipped
-

## Blockers
-

## Feedback (them → you)
-

## Feedback (you → them)
-

## Career / growth
-

## Follow-ups
- [ ]

## Appraisal candidates
<!-- Auto-suggested from lookback — Save records into appraisal note -->
`;

const RANGE_OPTIONS = EVIDENCE_RANGE_PRESETS.map((d) => ({
  value: String(d) as `${EvidenceRangeDays}`,
  label: `${d}d`,
}));

interface YearGoalsPayload {
  year: number;
  goals: { slug: string; title: string; status: string }[];
}

function candidateBullet(s: EvidenceSuggestion): string {
  return `- [${s.kind}] ${s.title} — ${s.summary} (${s.url})`;
}

function readStoredTemplate(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TEMPLATE_STORAGE_KEY);
}

export default function OneOnOneClient() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const year = useMemo(() => new Date().getFullYear(), []);
  const [days, setDays] = useEvidenceRangeDays();
  const { data, isLoading, error } = useLive<{ suggestions: EvidenceSuggestion[] }>(
    `/api/appraisal/evidence?days=${days}`,
    { refreshInterval: 0 },
  );
  const { data: yearData } = useLive<YearGoalsPayload>(`/api/appraisal/year?year=${year}`, {
    refreshInterval: 0,
  });
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState(() => DEFAULT_TEMPLATE.replace("{{date}}", today));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredTemplate();
    if (stored?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration on mount
      setTemplate(stored.includes("{{date}}") ? stored.replace("{{date}}", today) : stored);
    }
    setHydrated(true);
  }, [today]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(TEMPLATE_STORAGE_KEY, template);
  }, [template, hydrated]);

  const suggestions = data?.suggestions ?? [];
  const activeGoals = (yearData?.goals ?? []).filter((g) => g.status === "active" || g.status === "revised");

  const insertCandidate = useCallback(
    (s: EvidenceSuggestion, section: "Wins / shipped" | "Follow-ups") => {
      setTemplate((prev) => insertUnderHeading(prev, section, candidateBullet(s)));
      toast.success(`Inserted into ${section}`);
    },
    [toast],
  );

  async function copyTemplate() {
    try {
      await copyTextToClipboard(template);
      toast.success("1:1 template copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function createNote() {
    setCreating(true);
    try {
      const path = `one-on-ones/${today}`;
      const res = await fetch(`/api/notes/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: textToBlocks(template) }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Note written to notes/${path}.json`);
      window.location.href = `/notes/${path}`;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed — copy template instead");
    } finally {
      setCreating(false);
    }
  }

  function resetTemplate() {
    setTemplate(DEFAULT_TEMPLATE.replace("{{date}}", today));
    toast.info("Template reset to default");
  }

  return (
    <div className="page-wrapper">
      <PageHeader
        title="1:1 capture"
        subtitle="Editable template + lookback candidates. Create note writes the vault; Save cites appraisal."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/appraisal" className="btn btn-ghost text-xs">
              Appraisal year
            </Link>
            <button type="button" className="btn btn-ghost text-xs" onClick={resetTemplate}>
              Reset template
            </button>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => void copyTemplate()}>
              <Copy size={13} />
              Copy
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={() => void createNote()}
              disabled={creating}
            >
              <FilePlus2 size={13} />
              {creating ? "Writing…" : "Create note"}
            </button>
          </div>
        }
      />

      {activeGoals.length > 0 ? (
        <section className="card mt-4">
          <div className="card-header flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Target size={12} /> {year} goals
            </span>
            <Link href="/appraisal" className="btn btn-ghost text-[11px]">
              Open appraisal
            </Link>
          </div>
          <div className="card-body flex flex-wrap gap-1.5 text-xs">
            {activeGoals.map((g) => (
              <span key={g.slug} className="badge badge-muted">
                {g.title}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card mt-4">
        <div className="card-header flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Users size={12} /> Appraisal candidates{" "}
            <span className="badge badge-muted font-normal">{evidenceRangeLabel(days)}</span>
          </span>
          <ToggleGroup
            aria-label="Candidate date range"
            size="sm"
            value={String(days) as `${EvidenceRangeDays}`}
            onChange={(v) => setDays(Number(v) as EvidenceRangeDays)}
            options={RANGE_OPTIONS}
          />
        </div>
        <div className="card-body space-y-2 text-xs text-text-subtle">
          {error ? (
            <p style={{ color: "var(--danger)" }}>{error.message}</p>
          ) : (
            <EvidenceSuggestionList
              suggestions={suggestions}
              isLoading={isLoading}
              max={8}
              showSaveAll
              emptyMessage="No artifacts in this range — check Jira / GitHub / Datadog setup, or widen the lookback."
              renderExtraActions={(s) => (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    onClick={() => insertCandidate(s, "Wins / shipped")}
                  >
                    → Wins
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    onClick={() => insertCandidate(s, "Follow-ups")}
                  >
                    → Follow-ups
                  </button>
                </>
              )}
            />
          )}
        </div>
      </section>

      <section className="card mt-4">
        <div className="card-header flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
          <span>Meeting template</span>
          <span className="font-normal text-text-subtle">
            Edits persist locally · Create note → <code>notes/one-on-ones/{today}</code>
          </span>
        </div>
        <div className="card-body">
          {!hydrated ? (
            <SkeletonRows count={6} height={28} />
          ) : (
            <textarea
              className="min-h-[50vh] w-full resize-y rounded-lg border border-border bg-bg-elevated p-4 font-mono text-xs leading-relaxed text-text"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              spellCheck={false}
              aria-label="1:1 meeting template"
            />
          )}
        </div>
      </section>
    </div>
  );
}
