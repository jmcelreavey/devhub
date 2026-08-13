"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState, FetchError, PageHeader } from "@/components";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { revalidateOwnedRepos } from "@/lib/ownership/owned-repos-swr";
import { useToast } from "@/lib/hooks/use-toast";
import { obligationCells } from "@/lib/ownership/obligations";
import type { AttentionSummary } from "@/lib/ownership/obligations";
import type { ObligationTone, RepoObligations, ResolvedOwnedRepo } from "@/lib/ownership/types";

interface SummaryRow {
  repo: ResolvedOwnedRepo;
  obligations: RepoObligations;
  openPrs: number;
  attention: AttentionSummary;
  error: string | null;
}

interface Payload {
  repos: ResolvedOwnedRepo[];
  summaries?: SummaryRow[];
}

const TONE_COLOR: Record<ObligationTone, string> = {
  ok: "var(--success)",
  bad: "var(--warning)",
  unknown: "var(--text-muted)",
};

function repoHref(fullName: string): string {
  const [owner, name] = fullName.split("/");
  return `/own/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
}

export default function OwnIndex() {
  const toast = useToast();
  const confirm = useConfirm();
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useLive<Payload>("/api/own?summary=1", { refreshInterval: 120_000, revalidateOnMount: true });
  const summaryByRepo = new Map((data?.summaries ?? []).map((row) => [row.repo.fullName, row] as const));

  async function updateOwnership(method: "POST" | "DELETE", repo: string) {
    setBusy(repo);
    try {
      const response = await fetch("/api/own", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: repo }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update ownership");
      setFullName("");
      revalidateOwnedRepos();
      await mutate();
      toast.success(method === "POST" ? `${repo} is now owned.` : `${repo} removed.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update ownership");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Own"
        subtitle="Repo-centric radar for the changes, gaps, and obligations you are accountable for."
      />

      <form
        className="card card-body mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (fullName.trim()) void updateOwnership("POST", fullName.trim());
        }}
      >
        <label className="min-w-0 flex-1 text-xs font-medium text-text-subtle">
          Add an owned repository
          <input
            className="input mt-1 w-full"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="owner/repository"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn btn-primary max-sm:min-h-11" disabled={!fullName.trim() || busy !== null}>
          <Plus size={13} /> Own repo
        </button>
      </form>

      <div className="mt-4 space-y-3">
        {error && <FetchError message={error.message} onRetry={() => void mutate()} />}
        {isLoading && !data && [1, 2, 3].map((row) => <div key={row} className="skeleton h-28 rounded-lg" />)}
        {data?.repos.map((repo) => (
          <RepoCard
            key={repo.fullName}
            repo={repo}
            summary={summaryByRepo.get(repo.fullName)}
            busy={busy !== null}
            onRemove={async () => {
              const confirmed = await confirm({
                title: `Stop owning ${repo.fullName}?`,
                message: "This removes the repository from your ownership radar. It does not change the GitHub repository.",
                confirmLabel: "Stop owning",
                variant: "danger",
              });
              if (confirmed) await updateOwnership("DELETE", repo.fullName);
            }}
          />
        ))}
        {data && data.repos.length === 0 && (
          <EmptyState
            icon={<ShieldCheck size={34} />}
            title="No owned repos yet"
            subtitle="Add owner/repo above, or use the ownership toggle on Repos."
          />
        )}
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  summary,
  busy,
  onRemove,
}: {
  repo: ResolvedOwnedRepo;
  summary: SummaryRow | undefined;
  busy: boolean;
  onRemove: () => Promise<void>;
}) {
  const cells = summary && !summary.error ? obligationCells(summary.obligations) : null;
  return (
    <article className="card card-body">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-accent" aria-hidden />
            <h2 className="truncate text-sm font-semibold text-text">{repo.fullName}</h2>
          </div>
          <p className="mt-1 text-xs text-text-subtle">
            {repo.localPath ? `Local clone: ${repo.localRepoName}` : "GitHub-only until cloned"}
            {summary && !summary.error && ` · ${summary.openPrs} open PR${summary.openPrs === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost max-sm:min-h-11 max-sm:min-w-11"
            aria-label={`Stop owning ${repo.fullName}`}
            disabled={busy}
            onClick={() => void onRemove()}
          >
            <Trash2 size={13} />
          </button>
          <Link href={repoHref(repo.fullName)} className="btn btn-primary text-xs max-sm:min-h-11">
            Open radar <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {cells ? (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {cells.map((cell) => (
            <div key={cell.label} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[cell.tone] }} aria-hidden />
                {cell.label}
                {cell.tone === "unknown" && <span className="sr-only"> (could not be determined)</span>}
              </div>
              <div className="mt-1 text-sm font-medium text-text">{cell.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-subtle">
          <AlertTriangle size={13} /> {summary?.error ?? "Loading this repo's obligations..."}
        </div>
      )}

      {summary?.attention.reasons.length ? (
        <p className="mt-2 text-[11px] text-warning">
          Needs attention: {summary.attention.reasons.slice(0, 3).join(" · ")}
        </p>
      ) : null}
    </article>
  );
}
