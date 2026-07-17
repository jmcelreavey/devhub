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
import { HoverTip } from "@/components/HoverTip";
import { usePrompt } from "@/components/ConfirmDialog";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
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
    <div className="card mb-3 repos-toolbar" style={{ padding: 14 }}>
      <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
        <label
          htmlFor="repos-filter"
          className="text-xs font-medium tracking-tight flex items-center gap-2"
          style={{ color: "var(--text-subtle)" }}
        >
          <Search size={12} aria-hidden /> Search
        </label>
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter local repos">
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
      <input
        id="repos-filter"
        className="input"
        placeholder="Filter local… type to also search GitHub"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
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
        <div className="text-xs font-medium tracking-tight" style={{ color: "var(--text-subtle)" }}>{label}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{description}</div>
      </div>
      <span className="badge badge-muted">{count}</span>
    </div>
  );
}

export function EmptyReposCard({ children }: { children: ReactNode }) {
  return (
    <div className="card card-body text-sm" style={{ color: "var(--text-muted)" }}>
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
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold text-sm break-words leading-snug" style={{ color: "var(--text)" }}>
              {repo.name}
            </div>
            {repo.branch && <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />}
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
                aria-label="Upstart options"
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
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                    style={{ color: "var(--text)" }}
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
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                    style={{ color: "var(--text)" }}
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
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                    style={{ color: "var(--text)" }}
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
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs no-underline hover:bg-[var(--bg-elevated)]"
                      style={{ color: "var(--text)" }}
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

        <div className="mt-2">
          <RepoGitWorkspace
            repoName={repo.name}
            repoPath={repo.path}
            dirtyCount={repo.dirtyCount}
            unpushedCount={repo.unpushedCount ?? 0}
            onMutate={onRefreshLocal}
          />
        </div>

        <details className="repos-card-more mt-2">
          <summary className="repos-card-more-summary">
            <span className="truncate font-mono" title={repo.path}>{repo.path}</span>
          </summary>
        </details>
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
          <div className="font-medium text-sm mb-0.5 break-words leading-snug" style={{ color: "var(--text)" }}>
            {repo.fullName}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {repo.defaultBranch && <MetaChip icon={<GitBranch size={11} />} label={repo.defaultBranch} />}
            {repo.isPrivate && <span className="badge badge-muted" style={{ fontSize: "10px" }}>private</span>}
            {repo.localRepoName && <span className="badge badge-success" style={{ fontSize: "10px" }}>Local: {repo.localRepoName}</span>}
          </div>
          {repo.description && (
            <div className="text-xs mt-1 break-words leading-snug" style={{ color: "var(--text-subtle)" }}>
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
    <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-subtle)" }}>
      {icon}
      {label}
    </span>
  );
}

const smallButtonStyle = { fontSize: "12px", padding: "3px 8px" } satisfies CSSProperties;
