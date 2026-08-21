"use client";

import { type CSSProperties, type ReactNode } from "react";
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
  MonitorPlay,
  Rocket,
  ScanSearch,
  Shield,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import { HoverTip } from "@/components/ui/HoverTip";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import {
  ContextMenu,
  RowMenuKebab,
  SectionMenuHint,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { RepoOpenPrLink } from "@/components/repos/RepoOpenPrLink";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { launchAgentJob } from "@/lib/agent-job";
import { agentSkillCommand, claudeCliCommand, opencodeCliCommand, openTerminal } from "@/lib/terminal-launch";
import type { GithubRepoInfo, RepoInfo } from "./types";

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
  onClaudeDesktop: () => void | Promise<void>;
  onRemove: (name: string) => void;
  onRefreshLocal: () => void;
  ownershipFullName: string | null;
  owned: boolean;
  ownershipBusy: string | null;
  onToggleOwned: (fullName: string, owned: boolean) => void;
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
}: {
  query: string;
  onQueryChange: (value: string) => void;
  localFilter: "changed" | "unpushed" | null;
  onLocalFilterChange: (value: "changed" | "unpushed" | null) => void;
  changedCount: number;
  unpushedCount: number;
}) {
  return (
    /*
      One row, not two. The old layout put a "🔍 Search" label on its own line
      directly above the input — with the magnifier it read as a second, empty
      search field stacked on the real one. The placeholder already says what
      the input does, so the label is now screen-reader only and the filter
      chips share the input's row, which also buys back a row of vertical space
      on a page that has to show 52 repos.
    */
    <div className="card mb-3 repos-toolbar" style={{ padding: 12 }}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="repos-filter" className="sr-only">
          Filter local repositories, or type to search GitHub
        </label>
        <SearchInput
          id="repos-filter"
          wrapperClassName="min-w-[14rem] flex-1 mb-0"
          placeholder="Filter local… type to also search GitHub"
          value={query}
          onChange={onQueryChange}
        />
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
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: "warning" | "accent";
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
  onClaudeDesktop,
  onRemove,
  onRefreshLocal,
  ownershipFullName,
  owned,
  ownershipBusy,
  onToggleOwned,
}: LocalRepoCardProps) {
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
        promptCommand: await agentSkillCommand(
          "project-graveyard",
          instruction,
          "run project-graveyard",
        ),
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
                message: "Optional startup context for OpenCode. Leave blank to continue without it.",
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
                promptCommand: await agentSkillCommand(
                  "scope-creep-detector",
                  instruction,
                  "run scope-creep-detector",
                ),
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
        {
          id: "opencode",
          label: "OpenCode CLI",
          icon: <TerminalSquare size={12} />,
          onSelect: () =>
            openTerminal({
              cwd: target.path,
              label: `OpenCode · ${target.name}`,
              command: opencodeCliCommand(),
            }),
        },
        {
          id: "claude-cli",
          label: "Claude CLI",
          icon: <TerminalSquare size={12} />,
          onSelect: () =>
            openTerminal({
              cwd: target.path,
              label: `Claude · ${target.name}`,
              command: claudeCliCommand(),
            }),
        },
        {
          id: "claude-app",
          label: "Claude app",
          icon: <Bot size={12} />,
          onSelect: () => void onClaudeDesktop(),
        },
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

  return (
    <div className="card group" style={{ padding: 0, overflow: "visible" }} {...menu.bindRow(repo)}>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold text-sm break-words leading-snug text-text">
              {repo.name}
              {owned ? (
                <span className="badge badge-muted" style={{ fontSize: 10 }}>
                  owned
                </span>
              ) : null}
            </div>
            {repo.branch && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />
                {githubUrl ? <RepoOpenPrLink repoName={repo.name} branch={repo.branch} /> : null}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
                className="btn btn-primary"
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                <Rocket size={12} /> Upstart
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
          Was a <details> containing only its <summary> — a disclosure triangle
          with cursor:pointer that expanded to nothing, on all 52 cards. An
          affordance that does nothing when clicked is worse than no affordance.
          Now a plain line: same information, no false promise, one less row of
          chrome per card.
        */}
        <div
          className="repos-card-path mt-1.5 truncate font-mono"
          title={repo.path}
        >
          {repo.path}
        </div>
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
    <span className="flex items-center gap-1 text-xs text-text-subtle">
      {icon}
      {label}
    </span>
  );
}

const smallButtonStyle = { fontSize: "12px", padding: "3px 8px" } satisfies CSSProperties;
