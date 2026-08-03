"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bot,
  Brain,
  ChevronDown,
  ClipboardCheck,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  MonitorPlay,
  MoreHorizontal,
  Rocket,
  Search,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { RepoOpenPrLink } from "@/components/repos/RepoOpenPrLink";
import { claudeCliCommand, opencodeCliCommand, openTerminal } from "@/lib/terminal-launch";
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
}

interface GithubRepoCardProps {
  repo: GithubRepoInfo;
  isDesktop: boolean;
  opening: string | null;
  cloning: string | null;
  onCursor: (name: string) => void;
  onClone: (fullName: string) => void;
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
        <div className="relative min-w-[14rem] flex-1">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-subtle"
          />
          <input
            id="repos-filter"
            className="input w-full"
            style={{ paddingLeft: 30 }}
            placeholder="Filter local… type to also search GitHub"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
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
}: {
  label: string;
  count: string | number;
  description: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="text-xs font-medium tracking-tight text-text-subtle">{label}</div>
        <div className="text-xs text-text-muted">{description}</div>
      </div>
      <span className="badge badge-muted">{count}</span>
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
}: LocalRepoCardProps) {
  const [upstartMenuOpen, setUpstartMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const upstartMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const prompt = usePrompt();

  useEffect(() => {
    if (!upstartMenuOpen && !moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (upstartMenuRef.current?.contains(target)) return;
      if (moreMenuRef.current?.contains(target)) return;
      setUpstartMenuOpen(false);
      setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUpstartMenuOpen(false);
        setMoreOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [upstartMenuOpen, moreOpen]);

  const busy = opening !== null || removing !== null;

  return (
    <div className="card" style={{ padding: 0, overflow: "visible" }}>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold text-sm break-words leading-snug text-text">
              {repo.name}
            </div>
            {repo.branch && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />
                {githubUrl ? <RepoOpenPrLink repoName={repo.name} branch={repo.branch} /> : null}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div ref={upstartMenuRef} className="relative inline-flex">
              <HoverTip
                label={
                  repo.hasUpstart
                    ? "Run DevHub upstart for this repo"
                    : "Ask the agent to create a DevHub upstart and start this repo"
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setUpstartMenuOpen(false);
                    onUpstart(repo);
                  }}
                  className="btn btn-primary"
                  style={{ fontSize: "12px", padding: "4px 10px", borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                >
                  <Rocket size={12} /> Upstart
                </button>
              </HoverTip>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: "12px", padding: "4px 6px", borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid color-mix(in srgb, var(--bg) 25%, transparent)" }}
                aria-label="Start-up script options"
                aria-haspopup="menu"
                aria-expanded={upstartMenuOpen}
                onClick={() => {
                  setMoreOpen(false);
                  setUpstartMenuOpen((open) => !open);
                }}
              >
                <ChevronDown size={12} aria-hidden />
              </button>
              {upstartMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-52 rounded-md border p-1 shadow-xl"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)] text-text"
                    onClick={() => {
                      setUpstartMenuOpen(false);
                      onUpstart(repo, false, "");
                    }}
                  >
                    {repo.hasUpstart ? "Run upstart" : "Create and run upstart"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)] text-text"
                    onClick={async () => {
                      const context = await prompt({
                        title: repo.hasUpstart ? "Update and run upstart" : "Create and run upstart",
                        message: "Optional startup context for OpenCode. Leave blank to continue without it.",
                        input: { placeholder: "Context..." },
                        confirmLabel: "Run",
                      });
                      setUpstartMenuOpen(false);
                      if (context === null) return;
                      onUpstart(repo, false, context);
                    }}
                  >
                    {repo.hasUpstart ? "Update/run with context" : "Create/run with context"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)] text-text"
                    onClick={() => {
                      setUpstartMenuOpen(false);
                      onUpstart(repo, true);
                    }}
                  >
                    Debug/update upstart
                  </button>
                </div>
              )}
            </div>

            <HoverTip label="Skim this repo — architecture, gotchas, how to run it">
              <button
                type="button"
                onClick={() => onLearn(repo)}
                className="btn btn-ghost"
                style={smallButtonStyle}
                aria-label={`Learn ${repo.name}`}
              >
                <Brain size={12} />
                Learn
              </button>
            </HoverTip>

            {isDesktop && (
              <button
                type="button"
                onClick={() => onCursor(repo.name)}
                disabled={busy}
                className="btn btn-ghost"
                style={smallButtonStyle}
              >
                <MonitorPlay size={12} />
                {opening === repo.name ? "Opening..." : "Cursor"}
              </button>
            )}

            <div ref={moreMenuRef} className="relative inline-flex">
              <button
                type="button"
                className="btn btn-ghost"
                style={smallButtonStyle}
                aria-label={`More actions for ${repo.name}`}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => {
                  setUpstartMenuOpen(false);
                  setMoreOpen((open) => !open);
                }}
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-52 rounded-md border p-1 shadow-xl"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                >
                  <MoreItem
                    icon={<ClipboardCheck size={13} />}
                    label="DX Audit"
                    onSelect={() => {
                      setMoreOpen(false);
                      onDxAudit(repo);
                    }}
                  />
                  {githubUrl && (
                    <a
                      href={githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs no-underline hover:bg-[var(--bg-elevated)] text-text"
                      onClick={() => setMoreOpen(false)}
                    >
                      <ExternalLink size={13} aria-hidden /> GitHub
                    </a>
                  )}
                  {isDesktop && (
                    <MoreItem
                      icon={<TerminalSquare size={13} />}
                      label="Terminal"
                      onSelect={() => {
                        setMoreOpen(false);
                        onTerminal(repo);
                      }}
                    />
                  )}
                  <MoreItem
                    icon={<FolderOpen size={13} />}
                    label={apps?.revealLabel ?? "Show folder"}
                    onSelect={() => {
                      setMoreOpen(false);
                      onRevealFolder(repo.name);
                    }}
                  />
                  <MoreItem
                    icon={<TerminalSquare size={13} />}
                    label="OpenCode CLI"
                    onSelect={() => {
                      setMoreOpen(false);
                      openTerminal({
                        cwd: repo.path,
                        label: `OpenCode · ${repo.name}`,
                        command: opencodeCliCommand(),
                      });
                    }}
                  />
                  <MoreItem
                    icon={<TerminalSquare size={13} />}
                    label="Claude CLI"
                    onSelect={() => {
                      setMoreOpen(false);
                      openTerminal({
                        cwd: repo.path,
                        label: `Claude · ${repo.name}`,
                        command: claudeCliCommand(),
                      });
                    }}
                  />
                  <MoreItem
                    icon={<Bot size={13} />}
                    label="Claude app"
                    onSelect={() => {
                      setMoreOpen(false);
                      void onClaudeDesktop();
                    }}
                  />
                  {isDesktop && apps?.gitkraken && (
                    <MoreItem
                      icon={<GitBranch size={13} />}
                      label="GitKraken"
                      onSelect={() => {
                        setMoreOpen(false);
                        onGitKraken(repo.name);
                      }}
                    />
                  )}
                  <MoreItem
                    icon={<Trash2 size={13} />}
                    label={removing === repo.name ? "Removing..." : "Remove local"}
                    danger
                    disabled={busy}
                    onSelect={() => {
                      setMoreOpen(false);
                      onRemove(repo.name);
                    }}
                  />
                </div>
              )}
            </div>
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
    </div>
  );
}

function MoreItem({
  icon,
  label,
  onSelect,
  danger,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)] disabled:opacity-50"
      style={{ color: danger ? "var(--danger)" : "var(--text)" }}
      onClick={onSelect}
    >
      {icon}
      {label}
    </button>
  );
}

export function GithubRepoCard({
  repo,
  isDesktop,
  opening,
  cloning,
  onCursor,
  onClone,
}: GithubRepoCardProps) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm mb-0.5 break-words leading-snug text-text">
            {repo.fullName}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {repo.defaultBranch && <MetaChip icon={<GitBranch size={11} />} label={repo.defaultBranch} />}
            {repo.isPrivate && <span className="badge badge-muted" style={{ fontSize: "10px" }}>private</span>}
            {repo.localRepoName && <span className="badge badge-success" style={{ fontSize: "10px" }}>Local: {repo.localRepoName}</span>}
          </div>
          {repo.description && (
            <div className="text-xs mt-1 break-words leading-snug text-text-subtle">
              {repo.description}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <a href={repo.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={smallButtonStyle} aria-label={`Open ${repo.fullName} on GitHub`}>
            <ExternalLink size={12} />
          </a>
          {repo.localRepoName ? (
            isDesktop && (
              <button
                type="button"
                onClick={() => onCursor(repo.localRepoName!)}
                disabled={opening !== null}
                className="btn btn-ghost"
                style={smallButtonStyle}
                aria-label={`Open ${repo.localRepoName} in Cursor`}
              >
                <MonitorPlay size={12} />
              </button>
            )
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={smallButtonStyle}
              disabled={cloning !== null}
              onClick={() => onClone(repo.fullName)}
            >
              <Download size={12} />
              {cloning === repo.fullName ? "Cloning..." : "Clone"}
            </button>
          )}
        </div>
      </div>
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
