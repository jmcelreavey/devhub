"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, ShieldCheck } from "lucide-react";
import { EmptyState, FetchError, PageHeader } from "@/components";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
} from "@/components/shell/ContextMenu";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { useLive } from "@/lib/hooks/use-fetch";
import { revalidateOwnedRepos } from "@/lib/ownership/owned-repos-swr";
import { useToast } from "@/lib/hooks/use-toast";
import { obligationCells } from "@/lib/ownership/obligations";
import type { AttentionSummary } from "@/lib/ownership/obligations";
import {
  OWN_INDEX_FILTERS,
  ownedCardMeta,
  ownIndexFilterCounts,
  presentOwnedIndex,
  type OwnedIndexSignals,
  type OwnIndexFilter,
} from "@/lib/ownership/index-view";
import type { ObligationTone, RepoObligations, ResolvedOwnedRepo } from "@/lib/ownership/types";
import type { RepoInfo, ReposApiPayload } from "@/app/repos/types";
import { copyTextAndToast } from "@/lib/pr-slack";
import { openInBrowser } from "@/lib/desktop/bridge";
import { openRepoInCursor } from "@/lib/open-in-cursor-client";
import {
  agentRepoUpstartCommand,
  agentSkillCommand,
  openTerminal,
  repoUpstartCommand,
} from "@/lib/terminal-launch";
import {
  buildOwnedRepoMenuGroups,
  ownedRepoCatchUpHref,
  ownedRepoCloneUrl,
  ownedRepoGapsHref,
  ownedRepoHref,
  ownedRepoLearnHref,
  ownedRepoPullsUrl,
} from "./owned-repo-menu";

interface SummaryRow {
  repo: ResolvedOwnedRepo;
  obligations: RepoObligations;
  openPrs: number;
  reviewRequested: number;
  unattended: number;
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

export default function OwnIndex() {
  const toast = useToast();
  const confirm = useConfirm();
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<OwnIndexFilter>("all");
  const { data, error, isLoading, mutate } = useLive<Payload>("/api/own?summary=1", { refreshInterval: 120_000, revalidateOnMount: true });
  const { data: localData, mutate: mutateLocal } = useLive<ReposApiPayload>("/api/repos", { refreshInterval: 0 });
  const { data: apps } = useLive<{ gitkraken: boolean; revealLabel?: string }>("/api/repos/apps", { refreshInterval: 0 });
  const summaries = useMemo(() => data?.summaries ?? [], [data?.summaries]);
  const visibleRepos = useMemo(() => {
    const repos = data?.repos ?? [];
    if (summaries.length === 0) {
      if (filter === "missing-clone") return repos.filter((repo) => !repo.localPath);
      return repos;
    }
    const byName = new Map(repos.map((repo) => [repo.fullName, repo] as const));
    return presentOwnedIndex(summaries, filter).flatMap((row) => {
      const repo = byName.get(row.repo.fullName);
      return repo ? [repo] : [];
    });
  }, [data?.repos, filter, summaries]);
  const filterCounts = useMemo(
    // Pin T to the signal shape: the fallback rows carry no obligations, and inferring
    // T from the first branch would demand them.
    () => ownIndexFilterCounts<OwnedIndexSignals>(summaries.length ? summaries : (data?.repos ?? []).map((repo) => ({
      repo,
      openPrs: 0,
      reviewRequested: 0,
      unattended: 0,
      attention: { score: 0 },
      error: null,
    }))),
    [data?.repos, summaries],
  );
  const summaryByRepo = new Map(summaries.map((row) => [row.repo.fullName, row] as const));
  const localByName = useMemo(
    () => new Map((localData?.repos ?? []).map((row) => [row.name, row])),
    [localData?.repos],
  );

  async function refreshLists() {
    revalidateOwnedRepos();
    await Promise.all([mutate(), mutateLocal()]);
  }

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
      await refreshLists();
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

      {data && data.repos.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter owned repos">
          {OWN_INDEX_FILTERS.map((chip) => {
            const count = filterCounts[chip.id];
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={`badge ${active ? "badge-accent" : count === 0 ? "badge-muted" : "badge-warning"}`}
                style={{
                  cursor: "pointer",
                  border: active ? "1px solid var(--accent)" : "1px solid transparent",
                  fontSize: 11,
                  padding: "3px 8px",
                }}
                aria-pressed={active}
                onClick={() => setFilter(chip.id)}
              >
                {chip.label}
                <span style={{ opacity: 0.85, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {error && <FetchError message={error.message} onRetry={() => void mutate()} />}
        {isLoading && !data && [1, 2, 3].map((row) => <div key={row} className="skeleton h-28 rounded-lg" />)}
        {visibleRepos.map((repo) => (
          <OwnRepoCard
            key={repo.fullName}
            repo={repo}
            summary={summaryByRepo.get(repo.fullName)}
            local={repo.localRepoName ? localByName.get(repo.localRepoName) ?? null : null}
            revealLabel={apps?.revealLabel ?? "Show folder"}
            busy={busy !== null}
            onLocalMutate={() => void refreshLists()}
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
        {data && data.repos.length > 0 && visibleRepos.length === 0 && (
          <p className="text-sm text-text-subtle">No owned repos match this filter.</p>
        )}
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

export function OwnRepoCard({
  repo,
  summary,
  local,
  revealLabel,
  busy,
  onRemove,
  onLocalMutate,
}: {
  repo: ResolvedOwnedRepo;
  summary: SummaryRow | undefined;
  local: RepoInfo | null;
  revealLabel: string;
  busy: boolean;
  onRemove: () => Promise<void>;
  onLocalMutate: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const prompt = usePrompt();
  const menu = useContextMenu<"row">();
  const [opening, setOpening] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const cells = summary && !summary.error ? obligationCells(summary.obligations) : null;
  const clonedName = repo.localRepoName;
  const clonedPath = local?.path ?? repo.localPath;

  const groups = buildOwnedRepoMenuGroups(
    {
      repo,
      revealLabel,
      busy,
      opening,
      cloning,
      hasUpstart: local?.hasUpstart === true,
    },
    {
      onOpenCursor: () => {
        if (!clonedName) return;
        setOpening(true);
        void openRepoInCursor(clonedName, toast).finally(() => setOpening(false));
      },
      onOpenGitWorkspace: () => setGitOpen(true),
      onOpenGithub: () => void openInBrowser(repo.url),
      onOpenRadar: () => router.push(ownedRepoHref(repo.fullName)),
      onOpenCatchUp: () => router.push(ownedRepoCatchUpHref(repo.fullName)),
      onOpenPrs: () => void openInBrowser(ownedRepoPullsUrl(repo.url)),
      onCopyCloneUrl: () => void copyTextAndToast(ownedRepoCloneUrl(repo.url), "clone URL", toast),
      onCopyFullName: () => void copyTextAndToast(repo.fullName, repo.fullName, toast),
      onReveal: () => {
        if (!clonedName) return;
        void (async () => {
          try {
            const res = await fetch(`/api/repos/${encodeURIComponent(clonedName)}/reveal`, { method: "POST" });
            if (!res.ok) throw new Error(await res.text());
          } catch (cause) {
            console.error("reveal owned repo:", cause);
            toast.error(`Couldn't open ${clonedName} in ${revealLabel}.`);
          }
        })();
      },
      onUpstart: () => {
        if (!clonedPath || !clonedName) return;
        void (async () => {
          const hasUpstart = local?.hasUpstart === true;
          let trimmedContext: string | undefined;
          if (!hasUpstart) {
            const entered = await prompt({
              title: "Create and run upstart",
              message: "Optional startup context for the agent. Leave blank to continue without it.",
              input: { placeholder: "Context..." },
              confirmLabel: "Run",
            });
            if (entered === null) return;
            trimmedContext = entered.trim();
          }
          const upstartPath =
            local?.upstartPath?.trim() ||
            `${(process.env.NEXT_PUBLIC_REPO_ROOT ?? "").trim()}/upstarts/${clonedName}/upstart.sh`;
          openTerminal({
            cwd: clonedPath,
            label: `Upstart · ${clonedName}`,
            command: hasUpstart
              ? repoUpstartCommand(upstartPath)
              : await agentRepoUpstartCommand(clonedName, upstartPath, trimmedContext),
          });
        })();
      },
      onClone: () => {
        setCloning(true);
        void (async () => {
          try {
            const res = await fetch("/api/repos/clone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fullName: repo.fullName }),
            });
            if (!res.ok) throw new Error(await res.text());
            toast.success(`Cloned ${repo.fullName}`);
            onLocalMutate();
          } catch (cause) {
            console.error("clone owned repo:", cause);
            toast.error(`Couldn't clone ${repo.fullName}.`);
          } finally {
            setCloning(false);
          }
        })();
      },
      onLearn: () => router.push(ownedRepoLearnHref(repo)),
      onKnowledgeGaps: () => router.push(ownedRepoGapsHref(repo.fullName)),
      onScopeCreep: () => {
        if (!clonedPath || !clonedName) return;
        void (async () => {
          openTerminal({
            cwd: clonedPath,
            label: `scope-creep · ${clonedName}`,
            command: await agentSkillCommand(
              "scope-creep-detector",
              `Check the current working tree of ${clonedName} for scope creep against the branch intent.`,
              "run scope-creep-detector",
            ),
          });
        })();
      },
      onStopOwning: () => void onRemove(),
    },
  );

  return (
    <article className="card card-body group" {...menu.bindRow("row")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-accent" aria-hidden />
            <Link
              href={ownedRepoHref(repo.fullName)}
              className="truncate text-sm font-semibold text-text no-underline hover:underline"
              onContextMenu={(event) => event.preventDefault()}
            >
              {repo.fullName}
            </Link>
          </div>
          <p className="mt-1 text-xs text-text-subtle">
            {summary
              ? ownedCardMeta(summary)
              : repo.localPath
                ? `Local clone: ${repo.localRepoName}`
                : "GitHub-only until cloned"}
          </p>
        </div>
        <RowMenuKebab
          label={`Actions for ${repo.fullName}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, "row")}
        />
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${repo.fullName} actions`}
      />
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
      {clonedName && clonedPath ? (
        <RepoGitWorkspace
          repoName={clonedName}
          repoPath={clonedPath}
          dirtyCount={local?.dirtyCount ?? 0}
          unpushedCount={local?.unpushedCount ?? 0}
          onMutate={onLocalMutate}
          open={gitOpen}
          onOpenChange={setGitOpen}
          hideTrigger
        />
      ) : null}
    </article>
  );
}
