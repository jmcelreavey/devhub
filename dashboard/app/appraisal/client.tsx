"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Download, Link2, Plus, Target, Users } from "lucide-react";
import { FetchError, PageHeader } from "@/components";
import { ToggleGroup } from "@/components/ToggleGroup";
import {
  EvidenceSuggestionList,
  type EvidenceSaveResult,
  type EvidenceSuggestion,
} from "@/components/EvidenceSuggestions";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";
import { setAppraisalGoal } from "@/lib/appraisal-record";
import {
  EVIDENCE_RANGE_PRESETS,
  evidenceRangeLabel,
  type EvidenceRangeDays,
} from "@/lib/appraisal-evidence-range";
import { useEvidenceRangeDays } from "@/lib/use-evidence-range-days";
import { useLive } from "@/lib/use-fetch";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/use-toast";

interface YearPayload {
  year: number;
  path: string;
  exists: boolean;
  goals: { slug: string; title: string; status: string; detail?: string }[];
  entries: {
    slug: string;
    title: string;
    theme: string;
    date: string;
    body: string;
    goal?: string;
    tags: string[];
  }[];
  coverage: { theme: string; label: string; count: number }[];
  markdownExport: string;
}

interface EvidencePayload {
  days: number;
  suggestions: EvidenceSuggestion[];
}

const RANGE_OPTIONS = EVIDENCE_RANGE_PRESETS.map((d) => ({
  value: String(d) as `${EvidenceRangeDays}`,
  label: `${d}d`,
}));

export default function AppraisalClient() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [days, setDays] = useEvidenceRangeDays();
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDetail, setGoalDetail] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  const key = `/api/appraisal/year?year=${year}`;
  const { data, error, isLoading, mutate } = useLive<YearPayload>(key, { refreshInterval: 0 });
  const evidenceKey = `/api/appraisal/evidence?days=${days}`;
  const { data: evidence, isLoading: evidenceLoading } = useLive<EvidencePayload>(evidenceKey, {
    refreshInterval: 0,
  });
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();

  const maxCoverage = useMemo(
    () => Math.max(1, ...(data?.coverage.map((c) => c.count) ?? [1])),
    [data],
  );

  async function exportMd() {
    if (!data?.markdownExport) return;
    try {
      await copyTextToClipboard(data.markdownExport);
      toast.success("HR export copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function copyAppraisalPrompt(s: EvidenceSuggestion) {
    const md = [
      `## ${s.title}`,
      `<!-- suggest theme: ${s.suggestedTheme} -->`,
      s.summary,
      "",
      `References: ${s.url}`,
      "",
      `Record via MCP: appraisal_record with theme=${s.suggestedTheme} and references=["${s.url}"]`,
    ].join("\n");
    try {
      await copyTextToClipboard(md);
      toast.success("Evidence draft copied — paste into appraisal_record");
    } catch {
      toast.error("Could not copy");
    }
  }

  function onEvidenceSaved(s: EvidenceSuggestion, result: EvidenceSaveResult) {
    if (result.warning) toast.info(result.warning);
    const entryYear = Number(s.date?.slice(0, 4) || year);
    if (entryYear === year) void mutate();
    else setYear(entryYear);
  }

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    const title = goalTitle.trim();
    if (!title || savingGoal) return;
    setSavingGoal(true);
    try {
      const result = await setAppraisalGoal({
        year,
        title,
        detail: goalDetail.trim() || undefined,
      });
      toast.success(result.created ? `Goal ${result.slug} added` : `Goal ${result.slug} updated`);
      setGoalTitle("");
      setGoalDetail("");
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save goal");
    } finally {
      setSavingGoal(false);
    }
  }

  async function setGoalStatus(slug: string, title: string, status: "achieved" | "dropped" | "active") {
    setStatusBusy(slug);
    try {
      await setAppraisalGoal({ year, title, id: slug, status });
      toast.success(status === "achieved" ? "Marked achieved" : status === "dropped" ? "Marked dropped" : "Reactivated");
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update goal");
    } finally {
      setStatusBusy(null);
    }
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <PageHeader
        title="Appraisal"
        subtitle="Year view — goals, evidence, theme coverage. Save cites into the appraisal note."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/one-on-one" className="btn btn-ghost text-xs">
              <Users size={13} />
              1:1 mode
            </Link>
            <label className="text-xs text-text-muted">
              Year
              <input
                type="number"
                className="ml-2 w-20 rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || year)}
              />
            </label>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => void exportMd()} disabled={!data}>
              <Download size={13} />
              HR export
            </button>
          </div>
        }
      />

      {error ? (
        <FetchError message={error.message} onRetry={() => void mutate()} />
      ) : isLoading || !data ? null : (
        <div className="mt-4 flex flex-col gap-4">
          {!data.exists && (
            <p className="text-xs text-text-subtle">
              No appraisal file for {year} yet. Hit <strong>Save</strong> on a suggestion below, add a goal, or use MCP{" "}
              <code>appraisal_record</code> — writes <code>notes/appraisal/self/{year}.json</code>.
            </p>
          )}

          <section className="card">
            <div className="card-header flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <Link2 size={12} /> Suggested evidence{" "}
                <span className="badge badge-muted font-normal">{evidenceRangeLabel(days)}</span>
              </span>
              <ToggleGroup
                aria-label="Evidence date range"
                size="sm"
                value={String(days) as `${EvidenceRangeDays}`}
                onChange={(v) => setDays(Number(v) as EvidenceRangeDays)}
                options={RANGE_OPTIONS}
              />
            </div>
            <div className="card-body space-y-2 text-xs text-text-subtle">
              <EvidenceSuggestionList
                suggestions={evidence?.suggestions ?? []}
                isLoading={evidenceLoading || evidence === undefined}
                emptyMessage="No PRs / Jira / Datadog artifacts to suggest in this range."
                showSaveAll
                onSaved={onEvidenceSaved}
                renderExtraActions={(s) => (
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    onClick={() => void copyAppraisalPrompt(s)}
                  >
                    Cite
                  </button>
                )}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-header text-xs font-semibold">Coverage heatmap</div>
            <div className="card-body grid gap-2 sm:grid-cols-4">
              {data.coverage.map((c) => (
                <div key={c.theme}>
                  <div className="mb-1 flex justify-between text-[11px] text-text-muted">
                    <span>{c.label}</span>
                    <span>{c.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-bg">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.round((c.count / maxCoverage) * 100)}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-header flex items-center gap-1.5 text-xs font-semibold">
              <Target size={12} /> Goals
            </div>
            <div className="card-body space-y-3 text-xs text-text-subtle">
              <form onSubmit={(e) => void addGoal(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] text-text-muted">Title</span>
                  <input
                    className="w-full rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text"
                    value={goalTitle}
                    onChange={(e) => setGoalTitle(e.target.value)}
                    placeholder="Ship matching pipeline to GA"
                    required
                  />
                </label>
                <label className="min-w-0 flex-[1.2]">
                  <span className="mb-1 block text-[11px] text-text-muted">Detail (optional)</span>
                  <input
                    className="w-full rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text"
                    value={goalDetail}
                    onChange={(e) => setGoalDetail(e.target.value)}
                    placeholder="What success looks like"
                  />
                </label>
                <button type="submit" className="btn btn-primary text-xs" disabled={savingGoal || !goalTitle.trim()}>
                  <Plus size={13} />
                  {savingGoal ? "Adding…" : "Add goal"}
                </button>
              </form>

              {data.goals.length === 0 ? (
                <p>No goals yet — add one above (same path as MCP <code>appraisal_set_goal</code>).</p>
              ) : (
                data.goals.map((g) => (
                  <div
                    key={g.slug}
                    className="flex flex-wrap items-start justify-between gap-2 border-b pb-2 last:border-0"
                    style={{ borderColor: "var(--border-muted)" }}
                  >
                    <div className="min-w-0">
                      <span className="text-text">{g.title}</span>{" "}
                      <span className="badge badge-muted">{g.status}</span>
                      <span className="ml-1 text-[10px] text-text-subtle">{g.slug}</span>
                      {g.detail ? <p className="mt-0.5">{g.detail}</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {g.status !== "achieved" ? (
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px]"
                          disabled={statusBusy === g.slug}
                          onClick={() => void setGoalStatus(g.slug, g.title, "achieved")}
                        >
                          Done
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px]"
                          disabled={statusBusy === g.slug}
                          onClick={() => void setGoalStatus(g.slug, g.title, "active")}
                        >
                          Reopen
                        </button>
                      )}
                      {g.status !== "dropped" ? (
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px]"
                          disabled={statusBusy === g.slug}
                          onClick={() => void setGoalStatus(g.slug, g.title, "dropped")}
                        >
                          Drop
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header text-xs font-semibold">Evidence</div>
            <div className="card-body space-y-3">
              {data.entries.length === 0 ? (
                <p className="text-xs text-text-subtle">No entries.</p>
              ) : (
                data.entries.map((e) => (
                  <article
                    key={e.slug}
                    className="border-b pb-3 last:border-0"
                    style={{ borderColor: "var(--border-muted)" }}
                  >
                    <div className="text-sm font-semibold text-text">{e.title}</div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      {e.date} · {e.theme}
                      {e.goal ? ` · goal:${e.goal}` : ""}
                    </div>
                    <div className="mt-1">
                      <SimpleMarkdown text={e.body} compact />
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header text-xs font-semibold">Summarize → markdown</div>
            <div className="card-body">
              <pre
                className="max-h-64 overflow-auto rounded p-3 text-[11px] leading-relaxed"
                style={{ background: "var(--bg)", color: "var(--text-subtle)" }}
              >
                {data.markdownExport}
              </pre>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
