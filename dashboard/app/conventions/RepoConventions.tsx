"use client";

import { useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { ClipboardCopy, ExternalLink, Plus, RefreshCw, Undo2 } from "lucide-react";
import { EmptyState, FetchError, SkeletonRows } from "@/components";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { CATEGORY_LABEL, RULE_CATEGORIES, type MineRun, type RuleCategory } from "@/lib/conventions/types";
import { formatDuration, formatRelative } from "@/lib/utils";
import {
  ConventionsApiError,
  conventionsUrl,
  IDLE_POLL_MS,
  MINING_POLL_MS,
  postConventions,
  type DetailPayload,
  type RuleAction,
  type RuleView,
} from "./api";
import { RuleCard } from "./RuleCard";
import { isRuleTextValid, RuleTextField } from "./RuleTextField";

type Filter = "active" | "rejected";

interface LastDecision {
  token: string;
  label: string;
  filter: Filter;
}

const FILTER_EMPTY: Record<Filter, string> = {
  active: "No active rules yet. Rejected rules remain available if you want to reinstate one.",
  rejected: "No rejected rules.",
};

function inFilter(rule: RuleView, filter: Filter): boolean {
  if (filter === "rejected") return rule.status === "rejected";
  return rule.active;
}

/** Strongest evidence first: more PRs, then more recently seen. */
function bySupport(a: RuleView, b: RuleView): number {
  return b.prs.length - a.prs.length || b.lastSeen.localeCompare(a.lastSeen);
}

function RunStrip({ run, mining, onRetry }: { run: MineRun | undefined; mining: boolean; onRetry: () => void }) {
  if (mining) {
    return (
      <div className="tone-panel tone-panel--accent text-xs mb-4" role="status">
        Learning from recent PR feedback and guidance docs. This can take several minutes; you can leave this page and return.
      </div>
    );
  }
  if (!run) return null;
  if (!run.ok) {
    return (
      <div className="tone-panel tone-panel--danger text-xs mb-4 flex flex-wrap items-center gap-2" role="alert">
        <span className="min-w-0">
          Last run failed {formatRelative(Date.parse(run.at))}: {run.error ?? "unknown error"}
        </span>
        <button type="button" className="btn btn-ghost text-xs ml-auto" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  const parts = [
    `Last run ${formatRelative(Date.parse(run.at))}`,
    `${run.prsScanned} PR${run.prsScanned === 1 ? "" : "s"}`,
    run.considered > run.comments ? `${run.comments} of ${run.considered} comments` : `${run.comments} comments`,
    `+${run.added} new · ${run.autoAccepted ?? 0} automatically accepted · ${run.autoRejected ?? 0} automatically rejected · ${run.reinforced} reinforced`,
    [run.provider, run.model].filter(Boolean).join(" · "),
    formatDuration(run.ms),
  ];
  return (
    <details className="text-xs text-text-muted mb-3">
      <summary className="cursor-pointer min-h-8 py-1">{parts[0]} · {run.added} new rules</summary>
      <p className="mt-1 max-w-prose">{parts.slice(1).filter(Boolean).join(" · ")}</p>
    </details>
  );
}

function AddRule({ repo, onDone }: { repo: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<RuleCategory>("other");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost text-xs" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add a rule
      </button>
    );
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await postConventions({ action: "add", repo, text, category });
      setText("");
      setOpen(false);
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-body space-y-2">
      <RuleTextField
        value={text}
        onChange={setText}
        label="New rule"
        placeholder="One sentence a reviewer could check a diff against"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input text-xs"
          value={category}
          onChange={(e) => setCategory(e.target.value as RuleCategory)}
          aria-label="Category"
        >
          {RULE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary text-xs" disabled={busy || !isRuleTextValid(text)} onClick={() => void submit()}>
          Add rule
        </button>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RepoConventions({ repo }: { repo: string }) {
  const toast = useToast();
  const section = useRef<HTMLElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const { mutate: mutateOverview } = useSWRConfig();
  const { data, error, isLoading, mutate } = useLive<DetailPayload>(conventionsUrl(repo), {
    refreshInterval: (latest) => (latest?.mining ? MINING_POLL_MS : IDLE_POLL_MS),
  });
  const [filter, setFilter] = useState<Filter>("active");
  const [busy, setBusy] = useState(false);
  const [lastDecision, setLastDecision] = useState<LastDecision | null>(null);

  const rules = useMemo(() => data?.file?.rules ?? [], [data]);
  const counts = useMemo(
    () => ({
      pending: rules.filter((r) => r.status === "suggested").length,
      active: rules.filter((r) => inFilter(r, "active")).length,
      rejected: rules.filter((r) => inFilter(r, "rejected")).length,
    }),
    [rules],
  );

  const shown = filter;
  const visible = useMemo(() => rules.filter((r) => inFilter(r, shown)).sort(bySupport), [rules, shown]);
  const mining = data?.mining === true;
  const latestRun = data?.file?.runs[0];

  const mine = async (force: boolean): Promise<void> => {
    setBusy(true);
    try {
      await postConventions({ action: "mine", repo, force });
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start a run");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: RuleAction): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await postConventions({ ...action, repo });
      if (action.action === "status" && result.undoToken) {
        const label = action.status === "rejected" ? "Removed from active rules" : "Reinstated";
        setLastDecision({ token: result.undoToken, label: `${label}: ${rules.find((rule) => rule.id === action.ruleId)?.text ?? "rule"}`, filter: shown });
      }
      await Promise.all([mutate(), mutateOverview("/api/conventions")]);
      if (action.action === "status") requestAnimationFrame(() => undoButton.current?.focus());
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the rule");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (!lastDecision) return;
    setBusy(true);
    try {
      await postConventions({ action: "undo", repo, token: lastDecision.token });
      setFilter(lastDecision.filter);
      setLastDecision(null);
      await Promise.all([mutate(), mutateOverview("/api/conventions")]);
      section.current?.focus();
      toast.success("Decision undone");
    } catch (err) {
      if (err instanceof ConventionsApiError && (err.status === 409 || err.status === 404)) {
        setLastDecision(null);
      }
      toast.error(err instanceof Error ? err.message : "Could not undo the decision");
    } finally {
      setBusy(false);
    }
  };

  const copyMarkdown = async (): Promise<void> => {
    try {
      const res = await fetch(`${conventionsUrl(repo)}&format=markdown&agent=0`);
      const payload = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Request failed");
      if (!payload.markdown) {
        toast.info("No active rules to copy yet.");
        return;
      }
      await copyTextToClipboard(payload.markdown);
      toast.success("Copied as Markdown — paste it into an AGENTS.md");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy");
    }
  };

  if (isLoading && !data) return <SkeletonRows count={4} height={84} />;
  if (error && !data) return <FetchError message={error.message} onRetry={() => void mutate()} />;

  return (
    <section ref={section} tabIndex={-1} aria-label={`Conventions for ${repo}`}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-text min-w-0 truncate">
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent inline-flex items-center gap-1"
          >
            {repo} <ExternalLink size={11} aria-hidden />
          </a>
        </h2>
        <span className="flex w-full flex-wrap items-center gap-1.5 xl:ml-auto xl:w-auto">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => void copyMarkdown()} disabled={counts.active === 0}>
            <ClipboardCopy size={12} /> Copy as Markdown
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={busy || mining}
            title="Re-read every recent PR, not just the ones with new feedback"
            onClick={() => void mine(true)}
          >
            Rescan all
          </button>
          <button type="button" className="btn btn-ghost text-xs" disabled={busy || mining} onClick={() => void mine(false)}>
            <RefreshCw size={12} />
            {mining ? "Mining…" : "Refresh from PRs"}
          </button>
        </span>
      </div>

      <RunStrip run={latestRun} mining={mining} onRetry={() => void mine(false)} />
      {mining && rules.length === 0 ? <SkeletonRows count={3} height={84} /> : null}
      {rules.length > 0 ? (
        <p className="mb-3 text-xs text-text-muted">
          Agents use active rules automatically. Remove or reinstate a rule to override a decision.
        </p>
      ) : null}

      {counts.pending > 0 ? <p className="mb-3 text-xs text-text-muted" role="status">{counts.pending} existing suggestions await automatic assessment. Your existing decisions are preserved.</p> : null}
      {rules.length === 0 && !mining ? (
        <EmptyState
          title="Nothing learned for this repo yet"
          subtitle="Reviews and PR creation learn rules automatically from feedback and repo guidance. You can also start a run here. Supported rules become active; rejected candidates stay available to inspect."
          action={
            <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => void mine(false)}>
              <RefreshCw size={12} /> Mine this repo
            </button>
          }
        />
      ) : (
        <>
          {rules.length > 0 ? (
            <div className="mb-3">
              <ToggleGroup<Filter>
                aria-label="Filter rules"
                value={shown}
                onChange={setFilter}
                options={[
                  { value: "active", label: `Active (${counts.active})` },
                  { value: "rejected", label: `Rejected (${counts.rejected})` },
                ]}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            {visible.map((rule) => (
              <RuleCard key={rule.id} rule={rule} busy={busy} onAction={act} />
            ))}
            {visible.length === 0 && rules.length > 0 ? <p className="text-xs text-text-muted py-2">{FILTER_EMPTY[shown]}</p> : null}
          </div>
        </>
      )}

      {lastDecision ? (
        <div className="tone-panel tone-panel--accent mt-4 flex flex-wrap items-center gap-3">
          <p className="text-xs text-text min-w-0 flex-1" role="status">{lastDecision.label}</p>
          <button ref={undoButton} type="button" className="btn btn-ghost text-xs min-h-11 sm:min-h-8" disabled={busy} onClick={() => void undo()}>
            <Undo2 size={14} /> Undo last decision
          </button>
        </div>
      ) : null}
      <div className="mt-4">
        <AddRule repo={repo} onDone={async () => { await Promise.all([mutate(), mutateOverview("/api/conventions")]); }} />
      </div>

      {data?.storedAt ? (
        <p className="mt-6 text-xs text-text-muted">
          Stored in <code title={data.storedAt}>{data.storedAt.split("/").slice(-3).join("/")}</code> in your notes vault, committed
          with it.
        </p>
      ) : null}
    </section>
  );
}
