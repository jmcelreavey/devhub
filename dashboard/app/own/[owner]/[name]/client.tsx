"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ExternalLink,
  GitPullRequest,
  History,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { EmptyState, FetchError, PageHeader } from "@/components";
import { LabMarkdown } from "@/components/capability/LabMarkdown";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { obligationCells, attentionSummary } from "@/lib/ownership/obligations";
import type {
  KnowledgeGap,
  ObligationTone,
  OwnerBrief,
  RepoDigest,
  RepoPrRadarRow,
  ResolvedOwnedRepo,
} from "@/lib/ownership/types";
import type { CatchUpWindow } from "@/lib/catch-up";

interface BlastPayload {
  domains: { label: string; changedFiles: number }[];
  companions: { path: string; confidence: number }[];
  reviewers: { person: { displayName: string }; touches: number }[];
  analysedPaths: number;
  truncated: boolean;
  unavailable: string | null;
}

function apiPath(owner: string, name: string, suffix: string): string {
  return `/api/own/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

function repoHref(fullName: string): string {
  const [owner, name] = fullName.split("/");
  return `/own/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
}

const TONE_COLOR: Record<ObligationTone, string> = {
  ok: "var(--success)",
  bad: "var(--warning)",
  unknown: "var(--text-muted)",
};

export default function OwnerRepoPage({ owner, name }: { owner: string; name: string }) {
  const fullName = `${owner}/${name}`;
  const toast = useToast();

  // Three independent fetches rather than one brief. The PR radar and
  // obligations are the fast half; making them wait on a 90-day git log meant
  // the whole page sat on skeletons for seconds.
  const core = useLive<OwnerBrief>(apiPath(owner, name, "/brief?panels=core"), { refreshInterval: 120_000 });
  const gaps = useLive<{ gaps: KnowledgeGap[] }>(apiPath(owner, name, "/gaps"), { refreshInterval: 0 });
  const [digestWindow, setDigestWindow] = useState<CatchUpWindow>("watermark");
  const digestQuery = useLive<RepoDigest | null>(
    apiPath(owner, name, `/digest${digestWindow === "recent" ? "?since=recent" : ""}`),
    { refreshInterval: 0 },
  );

  const data = core.data;
  const [generatedDigest, setGeneratedDigest] = useState<{ window: CatchUpWindow; digest: RepoDigest } | null>(null);
  const digest = generatedDigest?.window === digestWindow ? generatedDigest.digest : digestQuery.data ?? null;
  const [refreshing, setRefreshing] = useState(false);

  const notOwned = core.error?.message?.includes("not an owned repository")
    || core.error?.message?.includes("not-owned");

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([core.mutate(), gaps.mutate(), digestQuery.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [core, gaps, digestQuery]);

  if (notOwned) {
    return (
      <div className="page-wrapper">
        <PageHeader title={fullName} subtitle="Not one of your owned repositories." />
        <div className="mt-6">
          <EmptyState
            icon={<AlertTriangle size={34} />}
            title="You don't own this repository"
            subtitle="Add it from the Own index to start tracking inbound change, obligations and gaps."
            action={<Link href="/own" className="btn btn-primary">Go to Own</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <PageHeader
        title={fullName}
        subtitle="Inbound change, review risk, knowledge gaps, and what landed while you were away."
        actions={data ? (
          <span className="flex items-center gap-1.5">
            <a className="btn btn-ghost text-xs max-sm:min-h-11" href={data.repo.url} target="_blank" rel="noreferrer">
              GitHub <ExternalLink size={12} />
            </a>
            <button
              type="button"
              className="btn btn-ghost max-sm:min-h-11 max-sm:min-w-11"
              onClick={() => void refreshAll()}
              aria-label="Refresh ownership radar"
              aria-busy={refreshing}
              disabled={refreshing}
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} aria-hidden />
            </button>
          </span>
        ) : null}
      />

      <OwnedTabs current={fullName} />

      {core.error && !notOwned && (
        <div className="mt-4"><FetchError message={core.error.message} onRetry={() => void core.mutate()} /></div>
      )}
      {core.isLoading && !data && (
        <div className="mt-4 space-y-3">{[1, 2, 3].map((row) => <div key={row} className="skeleton h-32 rounded-lg" />)}</div>
      )}

      {data && (
        <>
          {data.warnings.map((warning) => (
            <div key={warning} className="card card-body mt-4 flex items-start gap-2 text-xs text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {warning}
            </div>
          ))}
          <Obligations brief={data} />

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
            <div className="space-y-4 xl:order-2">
              <KnowledgeGaps
                repo={data.repo}
                gaps={gaps.data?.gaps ?? null}
                loading={gaps.isLoading}
                error={gaps.error?.message ?? null}
                onRetry={() => void gaps.mutate()}
              />
              <CatchUp
                digest={digest}
                loading={digestQuery.isLoading && !digest}
                error={digestQuery.error?.message ?? null}
                onRetry={() => void digestQuery.mutate()}
                window={digestWindow}
                onWindowChange={(value) => {
                  setGeneratedDigest(null);
                  setDigestWindow(value);
                }}
                onGenerated={(nextDigest) => setGeneratedDigest({ window: digestWindow, digest: nextDigest })}
                onCaughtUp={async () => {
                  if (!digest?.headSha) return;
                  const response = await fetch(apiPath(owner, name, "/brief"), {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ headSha: digest.headSha }),
                  });
                  if (!response.ok) {
                    toast.error("Could not save your place.");
                    return;
                  }
                  toast.success("Marked caught up.");
                  setGeneratedDigest(null);
                  setDigestWindow("watermark");
                  void digestQuery.mutate();
                }}
                owner={owner}
                name={name}
                toastError={(message: string) => toast.error(message)}
              />
            </div>
            <div className="xl:order-1">
              <PrRadar brief={data} owner={owner} name={name} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Repo switcher. Uses `/api/own` (list-only). The Own index uses
 * `/api/own?summary=1` — claim/unclaim must call `revalidateOwnedRepos()` so
 * both keys stay in sync. Marks the active tab for assistive technology.
 */
function OwnedTabs({ current }: { current: string }) {
  const { data } = useLive<{ repos: ResolvedOwnedRepo[] }>("/api/own", { refreshInterval: 0 });
  const repos = data?.repos ?? [];
  if (repos.length === 0) return null;
  return (
    <nav
      className="mt-4 flex gap-1 overflow-x-auto border-b pb-2"
      style={{ borderColor: "var(--border)" }}
      aria-label="Owned repositories"
    >
      {repos.map((repo) => {
        const active = repo.fullName === current;
        return (
          <Link
            key={repo.fullName}
            href={repoHref(repo.fullName)}
            aria-current={active ? "page" : undefined}
            className={`badge shrink-0 max-sm:min-h-11 ${active ? "badge-accent" : "badge-muted"}`}
          >
            {repo.name}
          </Link>
        );
      })}
    </nav>
  );
}

function Obligations({ brief }: { brief: OwnerBrief }) {
  const cells = obligationCells(brief.obligations);
  const attention = attentionSummary(brief.obligations, brief.prs);
  return (
    <section className="mt-4" aria-label="Repository obligations">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="card px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: TONE_COLOR[cell.tone] }}
                aria-hidden
              />
              {cell.label}
              {cell.tone === "unknown" && <span className="sr-only"> (could not be determined)</span>}
            </div>
            <div className="mt-1 text-sm font-medium text-text">{cell.value}</div>
          </div>
        ))}
      </div>
      {attention.reasons.length > 0 && (
        <p className="mt-2 text-[11px] text-warning">Needs attention: {attention.reasons.slice(0, 3).join(" · ")}</p>
      )}
    </section>
  );
}

function PrRadar({ brief, owner, name }: { brief: OwnerBrief; owner: string; name: string }) {
  const grouped = new Map<string, RepoPrRadarRow[]>();
  for (const pr of brief.prs) grouped.set(pr.team, [...(grouped.get(pr.team) ?? []), pr]);
  const inferred = new Set(brief.teams.filter((team) => team.source === "churn").map((team) => team.label));

  return (
    <section className="card card-body">
      <PanelTitle title="Inbound PR radar" detail={`${brief.prs.length} open`} />
      {brief.prs.length === 0 ? (
        <p className="mt-3 text-sm text-text-subtle">No open pull requests.</p>
      ) : [...grouped].map(([team, prs]) => (
        <div key={team} className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {team}
            {inferred.has(team) && (
              <span className="badge badge-muted normal-case" title="Grouped from commit history, not CODEOWNERS">
                inferred
              </span>
            )}
          </div>
          <div className="space-y-2">
            {prs.map((pr) => <PrRow key={pr.number} pr={pr} owner={owner} name={name} />)}
          </div>
        </div>
      ))}
    </section>
  );
}

function KnowledgeGaps({
  repo,
  gaps,
  loading,
  error,
  onRetry,
}: {
  repo: ResolvedOwnedRepo;
  gaps: KnowledgeGap[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="card card-body">
      <PanelTitle title="Knowledge gaps" detail="churn × unfamiliarity" />
      {loading && <div className="mt-3 space-y-2">{[1, 2, 3].map((row) => <div key={row} className="skeleton h-9 rounded" />)}</div>}
      {error && (
        <div className="mt-3">
          <FetchError message={error} onRetry={onRetry} />
        </div>
      )}
      {gaps && (
        <div className="mt-3 space-y-3">
          {gaps.slice(0, 5).map((gap, index) => (
            <div key={gap.domainId} className="border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">{index + 1}. {gap.label}</div>
                  <div className="mt-0.5 text-[11px] text-text-subtle">
                    {gap.evidence.commits90d} commits · {Math.round(gap.familiarity * 100)}% familiar
                  </div>
                </div>
                <Link
                  className="btn btn-ghost shrink-0 text-xs max-sm:min-h-11"
                  href={`/repos/learn/${encodeURIComponent(repo.localRepoName ?? repo.name)}?domain=${encodeURIComponent(gap.domainId)}&owned=${encodeURIComponent(repo.fullName)}`}
                >
                  <BookOpen size={12} /> Learn this
                </Link>
              </div>
            </div>
          ))}
          {gaps.length === 0 && (
            <p className="text-xs text-text-subtle">
              {repo.localPath ? "No domains detected yet." : "Clone the repo to calculate gaps."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Catch-up history.
 *
 * The watermark only moves when the owner says so. Advancing it on render meant
 * opening the page consumed the very thing the page exists to show — the panel
 * was empty on every visit after the first, with no way back.
 */
function CatchUp({
  digest,
  loading,
  error,
  onRetry,
  window: digestWindow,
  onWindowChange,
  onGenerated,
  onCaughtUp,
  owner,
  name,
  toastError,
}: {
  digest: RepoDigest | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  window: CatchUpWindow;
  onWindowChange: (value: CatchUpWindow) => void;
  onGenerated: (digest: RepoDigest) => void;
  onCaughtUp: () => Promise<void>;
  owner: string;
  name: string;
  toastError: (message: string) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState(false);
  const commits = digest?.commits ?? [];

  async function generate() {
    if (!digest) return;
    setGenerating(true);
    try {
      const response = await fetch(apiPath(owner, name, "/digest"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sinceSha: digest.sinceSha, headSha: digest.headSha }),
      });
      const body = await response.json() as RepoDigest & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not generate catch-up");
      onGenerated(body);
    } catch (cause) {
      toastError(cause instanceof Error ? cause.message : "Could not generate catch-up");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="card card-body">
      <PanelTitle
        title={digestWindow === "recent" ? "Recent history" : "Since I last looked"}
        detail={`${commits.length} commits`}
      />
      {loading && <div className="mt-3 space-y-2">{[1, 2].map((row) => <div key={row} className="skeleton h-8 rounded" />)}</div>}

      {!loading && error && (
        <div className="mt-3">
          <FetchError message={error} onRetry={onRetry} />
        </div>
      )}

      {!loading && !error && digest?.summaryMarkdown && <div className="mt-3"><LabMarkdown text={digest.summaryMarkdown} /></div>}

      {!loading && !error && !digest?.summaryMarkdown && (
        <div className="mt-3">
          <div className="space-y-2">
            {commits.slice(0, 8).map((commit) => (
              <div key={commit.sha} className="text-xs">
                <div className="text-text">{commit.subject}</div>
                <div className="text-[11px] text-text-muted">{commit.domains.join(", ") || "Unmapped"}</div>
              </div>
            ))}
            {commits.length === 0 && (
              <p className="text-xs text-text-subtle">
                {digestWindow === "recent" ? "No commits found." : "Nothing new since you last caught up."}
              </p>
            )}
          </div>
          {commits.length > 0 && (
            <button
              type="button"
              className="btn btn-primary mt-3 text-xs max-sm:min-h-11"
              onClick={() => void generate()}
              disabled={generating || !digest?.aiConfigured}
              aria-busy={generating}
            >
              <Sparkles size={12} /> {generating ? "Summarising..." : digest?.aiConfigured ? "Summarise by domain" : "AI not configured"}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        {digestWindow === "watermark" ? (
          <>
            <button
              type="button"
              className="btn btn-ghost text-xs max-sm:min-h-11"
              disabled={marking || commits.length === 0}
              aria-busy={marking}
              onClick={async () => {
                setMarking(true);
                try {
                  await onCaughtUp();
                } finally {
                  setMarking(false);
                }
              }}
            >
              <Check size={12} /> {marking ? "Saving..." : "Mark caught up"}
            </button>
            <button type="button" className="btn btn-ghost text-xs max-sm:min-h-11" onClick={() => onWindowChange("recent")}>
              <History size={12} /> Show recent history
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost text-xs max-sm:min-h-11" onClick={() => onWindowChange("watermark")}>
            <History size={12} /> Back to since I last looked
          </button>
        )}
      </div>
    </section>
  );
}

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-text">{title}</h2><span className="badge badge-muted">{detail}</span></div>;
}

function PrRow({ pr, owner, name }: { pr: RepoPrRadarRow; owner: string; name: string }) {
  const [blast, setBlast] = useState<BlastPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function expand() {
    if (blast || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiPath(owner, name, "/blast"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: pr.files.map((file) => file.path) }),
      });
      const body = await response.json().catch(() => ({})) as BlastPayload & { error?: string };
      // Previously this was `if (response.ok)` with no else, so a rejected
      // payload left an expanded row that never filled in and never explained.
      if (!response.ok) throw new Error(body.error ?? "Could not calculate blast radius");
      setBlast(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not calculate blast radius");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="rounded-md border px-3 py-2.5" style={{ borderColor: "var(--border)" }} onToggle={(event) => event.currentTarget.open && void expand()}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <a href={pr.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-text hover:underline" onClick={(event) => event.stopPropagation()}>
              <GitPullRequest size={13} className="mr-1 inline" />#{pr.number} {pr.title}
            </a>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-subtle">
              <span>{pr.author.login}</span><span>·</span><span>{pr.domains.join(", ") || "unmapped"}</span>
              {pr.isDraft && <span className="badge badge-muted">draft</span>}
              {pr.review.nobodyLooking && <span className="badge badge-warning">nobody looking</span>}
              {pr.stale && <span className="badge badge-warning">stale</span>}
              {pr.uncoveredPaths.length > 0 && <span className="badge badge-muted">no CODEOWNER</span>}
            </div>
          </div>
          <span className={`badge ${pr.checks === "failing" ? "badge-danger" : pr.checks === "passing" ? "badge-success" : "badge-muted"}`}>{pr.checks}</span>
        </div>
      </summary>
      <div className="mt-3 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        {loading && <div className="skeleton h-14 rounded" />}
        {error && (
          <div className="flex items-center justify-between gap-2 text-warning">
            <span className="flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</span>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => void expand()}>Retry</button>
          </div>
        )}
        {blast?.unavailable && <p className="text-text-subtle">{blast.unavailable}</p>}
        {blast && !blast.unavailable && (
          <>
            {blast.truncated && (
              <p className="mb-2 text-[11px] text-text-muted">
                Large change — analysed the first {blast.analysedPaths} files.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <BlastList title="Domains" items={blast.domains.map((domain) => `${domain.label} (${domain.changedFiles})`)} />
              <BlastList title="Missing companions" items={blast.companions.map((item) => `${item.path} (${Math.round(item.confidence * 100)}%)`)} empty="No strong omissions" />
              <BlastList title="Suggested reviewers" items={blast.reviewers.map((item) => `${item.person.displayName} (${item.touches})`)} empty="No history" />
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function BlastList({ title, items, empty = "None" }: { title: string; items: string[]; empty?: string }) {
  return <div><div className="mb-1 font-medium text-text-muted">{title}</div><ul className="space-y-1 text-text-subtle">{items.length ? items.map((item) => <li key={item} className="break-all">{item}</li>) : <li>{empty}</li>}</ul></div>;
}
