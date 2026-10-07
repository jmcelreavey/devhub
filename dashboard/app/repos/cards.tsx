"use client";
import { openAgentHandoff } from "@/lib/agent-handoff";

import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { RepoOpenPrLink } from "@/components/repos/RepoOpenPrLink";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import {
ContextMenu,
RowMenuKebab,
SectionMenuHint,
useContextMenu,
type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { HoverTip } from "@/components/ui/HoverTip";
import { SearchInput } from "@/components/ui/SearchInput";
import { launchAgentJob } from "@/lib/agent-job";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import {
Archive,
Bot,
Brain,
ClipboardCheck,
Copy,
Download,
ExternalLink,
FolderOpen,
GitBranch,
GitFork,
ListTodo,
MonitorPlay,
Rocket,
ScanSearch,
ScrollText,
Shield,
ShieldCheck,
TerminalSquare,
Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties,type ReactNode } from "react";
import type { GithubRepoInfo,LocalRepoFilter,RepoInfo,RepoTaskPreview } from "./types";

interface RepoApps {
  gitkraken: boolean;
  revealLabel?: string;
}

interface LocalRepoCardProps {
  repo: RepoInfo;
  githubUrl: string | null;
  apps?: RepoApps;
  isDesktop: boolean;
  opening: string | null;
  removing: string | null;
  onLearn: (repo: RepoInfo) => void;
  onDxAudit: (repo: RepoInfo) => void;
  onUpstart: (repo: RepoInfo, debug?: boolean, context?: string) => void;
  onTerminal: (repo: RepoInfo) => void;
  onRevealFolder: (name: string) => void;
  onGitKraken: (name: string) => void;
  onCursor: (name: string) => void;
  onRemove: (name: string) => void;
  onRefreshLocal: () => void;
  ownershipFullName: string | null;
  owned: boolean;
  ownershipBusy: string | null;
  onToggleOwned: (fullName: string, owned: boolean) => void;
  /** Open tasks linked to this repo, in Today's order. */
  openTasks?: readonly RepoTaskPreview[];
  /** Automatically assessed rules already in use. */
  conventionsActive?: number;
}

interface GithubRepoCardProps {
  repo: GithubRepoInfo;
  isDesktop: boolean;
  opening: string | null;
  cloning: string | null;
  onCursor: (name: string) => void;
  onClone: (fullName: string) => void;
  owned: boolean;
  ownershipBusy: string | null;
  onToggleOwned: (fullName: string, owned: boolean) => void;
}

export function SearchCard({
  query,
  onQueryChange,
  localFilter,
  onLocalFilterChange,
  changedCount,
  unpushedCount,
  worktreeCount,
  source,
  activeProjectLabel,
  hasFilters,
  onClearFilters,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  localFilter: LocalRepoFilter;
  onLocalFilterChange: (value: LocalRepoFilter) => void;
  changedCount: number;
  unpushedCount: number;
  worktreeCount: number;
  source: "local" | "github";
  activeProjectLabel?: string;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const filterLabels = { changed: "Changed", unpushed: "Unpushed", worktree: "Worktrees" };
  const activeFilters = source === "local"
    ? [activeProjectLabel, localFilter ? filterLabels[localFilter] : null, query.trim() ? `“${query.trim()}”` : null].filter(Boolean)
    : [];
  return (
    <div className="card mb-3 repos-toolbar p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          id="repos-filter"
          wrapperClassName="min-w-0 basis-56 flex-1 mb-0"
          placeholder={source === "local" ? "Filter local repositories…" : "Search GitHub repositories…"}
          value={query}
          onChange={onQueryChange}
        />
        {source === "local" && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter local repos">
            <FilterChip
              label="Changed"
              count={changedCount}
              active={localFilter === "changed"}
              tone="warning"
              onClick={() => onLocalFilterChange(localFilter === "changed" ? null : "changed")}
            />
            <FilterChip
              label="Unpushed"
              count={unpushedCount}
              active={localFilter === "unpushed"}
              tone="accent"
              onClick={() => onLocalFilterChange(localFilter === "unpushed" ? null : "unpushed")}
            />
            <FilterChip
              label="Worktrees"
              count={worktreeCount}
              active={localFilter === "worktree"}
              onClick={() => onLocalFilterChange(localFilter === "worktree" ? null : "worktree")}
            />
          </div>
        )}
        {source === "local" && hasFilters && (
          <button type="button" className="btn btn-ghost text-xs shrink-0" onClick={onClearFilters}>
            Clear filters
          </button>
        )}
      </div>
      {activeFilters.length > 0 && (
        <p className="mt-2 mb-0 text-xs text-text-muted break-words">
          Showing: {activeFilters.join(" · ")}
        </p>
      )}
    </div>
  );
}
function FilterChip({
  label,
  count = 0,
  active,
  tone = "accent",
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  tone?: "warning" | "accent";
  onClick: () => void;
}) {
  const idleClass = tone === "warning" ? "badge-warning" : "badge-accent";
  return (
    <button
      type="button"
      className={`badge ${active ? "badge-accent" : count === 0 ? "badge-muted" : idleClass}`}
      style={{
        cursor: "pointer",
        border: active ? "1px solid var(--accent)" : "1px solid transparent",
        fontSize: 11,
        padding: "3px 8px",
      }}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      <span style={{ opacity: 0.85, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

export function SectionHeader({
  label,
  count,
  description,
  actions,
}: {
  label: string;
  count: string | number;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium tracking-tight text-text-subtle">{label}</div>
          <SectionMenuHint />
        </div>
        <div className="text-xs text-text-muted">{description}</div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <span className="badge badge-muted">{count}</span>
      </div>
    </div>
  );
}

export function EmptyReposCard({ children }: { children: ReactNode }) {
  return (
    <div className="card card-body text-sm text-text-muted">
      {children}
    </div>
  );
}

export function LocalRepoCard({
  repo,
  githubUrl,
  apps,
  isDesktop,
  opening,
  removing,
  onLearn,
  onDxAudit,
  onUpstart,
  onTerminal,
  onRevealFolder,
  onGitKraken,
  onCursor,
  onRemove,
  onRefreshLocal,
  ownershipFullName,
  owned,
  ownershipBusy,
  onToggleOwned,
  openTasks = [],
  conventionsActive = 0,
}: LocalRepoCardProps) {
  const router = useRouter();
  const prompt = usePrompt();
  const toast = useToast();
  const menu = useContextMenu<RepoInfo>();

  const busy = opening !== null || removing !== null;
  const target = menu.target ?? repo;

  const runGraveyard = () => {
    const trimmed = target.path.replace(/\/+$/, "");
    const slash = trimmed.lastIndexOf("/");
    const projectsDir = slash > 0 ? trimmed.slice(0, slash) : trimmed;
    void (async () => {
      const instruction = `Scan ${projectsDir} for abandoned projects and report causes of death.`;
      await launchAgentJob({
        title: "project-graveyard",
        kind: "agent",
        cwd: projectsDir,
        promptText: `Use the project-graveyard skill. ${instruction}`,
        mode: "oneshot",
        alreadyConfirmed: true,
        reason: "Project graveyard",
      });
    })();
  };

  const groups: ContextMenuGroup[] = [
    {
      id: "run",
      label: "Run",
      items: [
        {
          id: "upstart",
          label: target.hasUpstart ? "Run upstart" : "Create and run upstart",
          icon: <Rocket size={12} />,
          onSelect: () => onUpstart(target, false, ""),
        },
        {
          id: "upstart-context",
          label: target.hasUpstart ? "Update/run with context" : "Create/run with context",
          icon: <Rocket size={12} />,
          onSelect: () => {
            void (async () => {
              const context = await prompt({
                title: target.hasUpstart ? "Update and run upstart" : "Create and run upstart",
                message: "Optional startup context for the agent. Leave blank to continue without it.",
                input: { placeholder: "Context..." },
                confirmLabel: "Run",
              });
              if (context === null) return;
              onUpstart(target, false, context);
            })();
          },
        },
        {
          id: "upstart-debug",
          label: "Debug/update upstart",
          icon: <Rocket size={12} />,
          onSelect: () => onUpstart(target, true),
        },
        {
          id: "learn",
          label: "Learn this repo",
          description: "Architecture, gotchas, how to run it",
          icon: <Brain size={12} />,
          onSelect: () => onLearn(target),
        },
        ...(ownershipFullName
          ? [
              {
                id: "conventions",
                label: "Conventions",
                description:
                  conventionsActive > 0
                    ? `${conventionsActive} active rule${conventionsActive === 1 ? "" : "s"}`
                    : "Rules learned and assessed automatically",
                icon: <ScrollText size={12} />,
                onSelect: () => router.push(`/conventions?repo=${encodeURIComponent(ownershipFullName)}`),
              },
            ]
          : []),
        {
          id: "dx",
          label: "DX Audit",
          icon: <ClipboardCheck size={12} />,
          onSelect: () => onDxAudit(target),
        },
        {
          id: "scope",
          label: "Scope creep",
          icon: <ScanSearch size={12} />,
          onSelect: () => {
            void (async () => {
              const instruction = `Check the current working tree of ${target.name} for scope creep against the branch intent.`;
              await launchAgentJob({
                title: `scope-creep · ${target.name}`,
                kind: "agent",
                cwd: target.path,
                repoName: target.name,
                promptText: `Use the scope-creep-detector skill. ${instruction}`,
                mode: "oneshot",
                alreadyConfirmed: true,
                reason: `Scope creep · ${target.name}`,
              });
            })();
          },
        },
        {
          id: "graveyard",
          label: "Project graveyard",
          icon: <Archive size={12} />,
          onSelect: runGraveyard,
        },
      ],
    },
    {
      id: "open",
      label: "Open",
      items: [
        ...(isDesktop
          ? [
              {
                id: "cursor",
                label: opening === target.name ? "Opening in Cursor…" : "Open in Cursor",
                icon: <MonitorPlay size={12} />,
                disabled: busy,
                onSelect: () => onCursor(target.name),
              },
              {
                id: "terminal",
                label: "Terminal",
                icon: <TerminalSquare size={12} />,
                onSelect: () => onTerminal(target),
              },
            ]
          : []),
        {
          id: "folder",
          label: apps?.revealLabel ?? "Show folder",
          icon: <FolderOpen size={12} />,
          onSelect: () => onRevealFolder(target.name),
        },
        ...(githubUrl
          ? [
              {
                id: "github",
                label: "Open on GitHub",
                icon: <ExternalLink size={12} />,
                onSelect: () => {
                  window.open(githubUrl, "_blank", "noopener,noreferrer");
                },
              },
            ]
          : []),
        {
          id: "copy-path",
          label: "Copy path",
          icon: <Copy size={12} />,
          onSelect: () =>
            void copyTextToClipboard(target.path).then(
              () => toast.success("Path copied"),
              () => toast.error("Could not copy path"),
            ),
        },
        { id: "agents", label: "Ask Agent", icon: <Bot size={12} />, onSelect: () => openAgentHandoff({ title: "Ask Agent · " + target.name, cwd: target.path, repoName: target.name, worktree: false }) },
        ...(isDesktop && apps?.gitkraken
          ? [
              {
                id: "gitkraken",
                label: "GitKraken",
                icon: <GitBranch size={12} />,
                onSelect: () => onGitKraken(target.name),
              },
            ]
          : []),
      ],
    },
    {
      id: "own",
      items: [
        ...(ownershipFullName
          ? [
              {
                id: "own-toggle",
                label: owned ? "Stop owning this repo" : "Own this repo",
                icon: owned ? <ShieldCheck size={12} /> : <Shield size={12} />,
                disabled: ownershipBusy !== null,
                onSelect: () => onToggleOwned(ownershipFullName, !owned),
              },
            ]
          : []),
        {
          id: "remove",
          label: removing === target.name ? "Removing…" : "Remove local",
          icon: <Trash2 size={12} />,
          danger: true,
          disabled: busy,
          onSelect: () => onRemove(target.name),
        },
      ],
    },
  ];

  const rowBind = menu.bindRow(repo);
  return (
    <div
      className="card group repo-card"
      data-repo={repo.name}
      data-has-work={openTasks.length > 0 || undefined}
      style={{ padding: 0, overflow: "visible", cursor: "pointer" }}
      {...rowBind}
      onClick={(e) => {
        rowBind.onClick?.(e);
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("a, button, input, textarea, [role='menu'], [role='menuitem']")) return;
        router.push(`/repos/${encodeURIComponent(repo.name)}`);
      }}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold text-sm break-words leading-snug text-text">
              <Link
                href={`/repos/${encodeURIComponent(repo.name)}`}
                className="hover:text-accent truncate"
                aria-label={`Open repo ${repo.name}`}
                title={repo.path}
                data-repo-link={repo.name}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(`/repos/${encodeURIComponent(repo.name)}`);
                }}
              >
                {repo.name}
              </Link>
              {owned ? (
                <span className="badge badge-muted" style={{ fontSize: 10 }}>
                  owned
                </span>
              ) : null}
              {conventionsActive > 0 && ownershipFullName ? (
                <Link
                  href={`/conventions?repo=${encodeURIComponent(ownershipFullName)}`}
                  className="badge badge-muted shrink-0 whitespace-nowrap"
                  style={{ fontSize: 10 }}
                  title="Active conventions used by agents for this repo"
                >
                  {conventionsActive} rules
                </Link>
              ) : null}
            </div>
            {(repo.branch || repo.worktreeOf || (repo.worktreeCount ?? 0) > 0) && (
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                {repo.branch && <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />}
                {(repo.worktreeCount ?? 0) > 0 && <Link className="text-xs text-text-muted hover:text-accent" href={`/repos/${encodeURIComponent(repo.name)}/git?tab=worktrees`}>{repo.worktreeCount} worktrees · Review cleanup</Link>}
                {repo.branch && githubUrl ? (
                  <RepoOpenPrLink repoName={repo.name} branch={repo.branch} />
                ) : null}
                {repo.worktreeOf ? (
                  <MetaChip
                    icon={<GitFork size={11} />}
                    label={`worktree of ${repo.worktreeOf.split("/").pop()}`}
                  />
                ) : null}
              </div>
            )}
          </div>
          {/*
            Upstart was a primary button on every card — 50-odd identical blue
            buttons shouting over the repo names. The card itself is the primary
            action (it opens the hub); upstart is one hover away, and stays in
            the menu and on the hub (⌘⏎).
          */}
          <div className="flex shrink-0 items-center gap-0.5">
            <HoverTip
              label={
                repo.hasUpstart
                  ? "Run DevHub upstart for this repo"
                  : "Ask the agent to create a DevHub upstart and start this repo"
              }
            >
              <button
                type="button"
                onClick={() => onUpstart(repo)}
                className="row-menu-kebab reveal-on-hover"
                aria-label={`Upstart ${repo.name}`}
              >
                <Rocket size={14} aria-hidden />
              </button>
            </HoverTip>
            <RowMenuKebab
              label={`Actions for ${repo.name}`}
              onOpen={(x, y) => menu.openAtPoint(x, y, repo)}
            />
          </div>
        </div>

        <div className="mt-1.5">
          <RepoGitWorkspace
            repoName={repo.name}
            repoPath={repo.path}
            dirtyCount={repo.dirtyCount}
            unpushedCount={repo.unpushedCount ?? 0}
            onMutate={onRefreshLocal}
          />
        </div>

        {/*
          Health line. Only renders when something is actually wrong — a badge
          reading "100 · healthy" on 40 of 52 cards would be pure noise and
          would bury the handful that need attention. Silence means fine.
        */}
        {(() => {
          if (!repo.health) return null;
          /*
            Only risks the card doesn't ALREADY show. Dirty and unpushed each
            have their own chip in the row above, so rendering them here again
            produced "42 unpushed" immediately followed by "42 unpushed
            commits" — visible the moment this ran in a browser, invisible while
            reading the code. What's left is the genuinely unsurfaced pair:
            detached HEAD and no remote. Both rare, both worth knowing.

            The score and the hygiene reasons ride along in the title so nothing
            computed is thrown away.
          */
          const unchipped = repo.health.risks.filter((r) => !/unpushed|uncommitted/i.test(r));
          if (unchipped.length === 0) return null;
          return (
            <div
              className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug"
              title={`Health ${repo.health.score}/100 · ${repo.health.reasons.join(" · ")}`}
            >
              <span
                aria-hidden
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: repo.health.level === "bad" ? "var(--danger)" : "var(--warning)",
                }}
              />
              <span className="truncate" style={{ color: "var(--text-subtle)" }}>
                {unchipped[0]}
                {unchipped.length > 1 ? ` +${unchipped.length - 1} more` : ""}
              </span>
            </div>
          );
        })()}

        {/*
          What you're doing here, not just what git thinks. The path line this
          replaced was the scan folder + the name above it on every card; it
          lives in the name's tooltip now.
        */}
        {openTasks.length > 0 ? (
          <div className="repo-card-work" title={openTasks.map((task) => task.text).join("\n")}>
            <ListTodo size={12} className="shrink-0" aria-hidden />
            {openTasks[0].jiraKey ? (
              <span className="repo-card-work-key">{openTasks[0].jiraKey}</span>
            ) : null}
            <span className="truncate">{openTasks[0].text}</span>
            {openTasks.length > 1 ? (
              <span className="repo-card-work-more">+{openTasks.length - 1}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${repo.name} actions`}
      />
    </div>
  );
}

export function GithubRepoCard({
  repo,
  isDesktop,
  opening,
  cloning,
  onCursor,
  onClone,
  owned,
  ownershipBusy,
  onToggleOwned,
}: GithubRepoCardProps) {
  const menu = useContextMenu<GithubRepoInfo>();
  const target = menu.target ?? repo;
  const groups: ContextMenuGroup[] = [
    {
      id: "open",
      items: [
        {
          id: "github",
          label: "Open on GitHub",
          icon: <ExternalLink size={12} />,
          onSelect: () => {
            window.open(target.url, "_blank", "noopener,noreferrer");
          },
        },
        {
          id: "own",
          label: owned ? "Stop owning this repo" : "Own this repo",
          icon: owned ? <ShieldCheck size={12} /> : <Shield size={12} />,
          disabled: ownershipBusy !== null,
          onSelect: () => onToggleOwned(target.fullName, !owned),
        },
        ...(target.localRepoName && isDesktop
          ? [
              {
                id: "cursor",
                label: opening === target.localRepoName ? "Opening…" : "Open in Cursor",
                icon: <MonitorPlay size={12} />,
                disabled: opening !== null,
                onSelect: () => onCursor(target.localRepoName!),
              },
            ]
          : []),
        ...(!target.localRepoName
          ? [
              {
                id: "clone",
                label: cloning === target.fullName ? "Cloning…" : "Clone",
                icon: <Download size={12} />,
                disabled: cloning !== null,
                onSelect: () => onClone(target.fullName),
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <div className="card group" style={{ padding: "12px 14px" }} {...menu.bindRow(repo)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm mb-0.5 break-words leading-snug text-text no-underline hover:underline"
            onContextMenu={(event) => event.preventDefault()}
          >
            {repo.fullName}
          </a>
          <div className="flex items-center gap-2 flex-wrap">
            {repo.defaultBranch && <MetaChip icon={<GitBranch size={11} />} label={repo.defaultBranch} />}
            {repo.isPrivate && <span className="badge badge-muted" style={{ fontSize: "10px" }}>private</span>}
            {repo.localRepoName && <span className="badge badge-success" style={{ fontSize: "10px" }}>Local: {repo.localRepoName}</span>}
            {owned ? <span className="badge badge-muted" style={{ fontSize: "10px" }}>owned</span> : null}
          </div>
          {repo.description && (
            <div className="text-xs mt-1 break-words leading-snug text-text-subtle">
              {repo.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!repo.localRepoName ? (
            <button
              type="button"
              className="btn btn-primary"
              style={smallButtonStyle}
              disabled={cloning !== null}
              onClick={() => onClone(repo.fullName)}
            >
              <Download size={12} />
              {cloning === repo.fullName ? "Cloning..." : "Clone"}
            </button>
          ) : null}
          <RowMenuKebab
            label={`Actions for ${repo.fullName}`}
            onOpen={(x, y) => menu.openAtPoint(x, y, repo)}
          />
        </div>
      </div>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${repo.fullName} actions`}
      />
    </div>
  );
}

function MetaChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-text-subtle">
      {icon}
      <span className="truncate" title={label}>{label}</span>
    </span>
  );
}

const smallButtonStyle = { fontSize: "12px", padding: "3px 8px" } satisfies CSSProperties;
