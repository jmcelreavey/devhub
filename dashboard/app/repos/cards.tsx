"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bot,
  Brain,
  ClipboardCheck,
  Download,
  ExternalLink,
  GitBranch,
  MonitorPlay,
  Rocket,
  Search,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { HoverTip } from "@/components/HoverTip";
import { LaunchMenu } from "@/components/LaunchMenu";
import { usePrompt } from "@/components/ConfirmDialog";
import { RepoBranchPanel } from "@/components/RepoBranchPanel";
import { RepoGitActions } from "@/components/RepoGitActions";
import { claudeCliCommand, opencodeCliCommand, openTerminal } from "@/lib/terminal-launch";
import type { GithubRepoInfo, RepoInfo } from "./types";

interface RepoApps {
  gitkraken: boolean;
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

export function SearchCard({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="card mb-3" style={{ padding: 14 }}>
      <label
        htmlFor="repos-filter"
        className="text-xs uppercase tracking-wide mb-2 flex items-center gap-2"
        style={{ color: "var(--text-subtle)" }}
      >
        <Search size={12} aria-hidden /> Search local and GitHub repos
      </label>
      <input
        id="repos-filter"
        className="input"
        placeholder="Search by repo name, owner, or description..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
    </div>
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
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>{label}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{description}</div>
      </div>
      <span className="badge badge-muted">{count}</span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  tone: "muted" | "warning" | "accent" | "success";
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const badgeClass =
    tone === "warning" ? "badge-warning" : tone === "accent" ? "badge-accent" : tone === "success" ? "badge-success" : "badge-muted";
  const style = {
    padding: "12px 14px",
    width: "100%",
    textAlign: "left",
    borderColor: active ? "var(--accent)" : undefined,
    cursor: onClick ? "pointer" : undefined,
  } satisfies CSSProperties;
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>{label}</div>
        <span style={{ color: "var(--text-subtle)" }}>{icon}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xl font-semibold" style={{ color: "var(--text)" }}>{value}</span>
        <span className={`badge ${active ? "badge-accent" : badgeClass}`}>{active ? "filtering" : value === 0 ? "quiet" : "needs eyes"}</span>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="card" style={style} onClick={onClick} aria-pressed={active}>
        {content}
      </button>
    );
  }
  return (
    <div className="card" style={style}>
      {content}
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
  onGitKraken,
  onCursor,
  onClaudeDesktop,
  onRemove,
  onRefreshLocal,
}: LocalRepoCardProps) {
  const [upstartMenuOpen, setUpstartMenuOpen] = useState(false);
  const upstartMenuRef = useRef<HTMLDivElement>(null);
  const prompt = usePrompt();
  const hasUnpushed = (repo.unpushedCount ?? 0) > 0;
  const statusTone = repo.dirtyCount > 0 ? "var(--warning)" : hasUnpushed ? "var(--accent)" : "var(--success)";

  useEffect(() => {
    if (!upstartMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (upstartMenuRef.current?.contains(event.target as Node)) return;
      setUpstartMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUpstartMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [upstartMenuOpen]);

  return (
    <div className="card" style={{ padding: 0, overflow: "visible", borderLeft: `3px solid ${statusTone}` }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-sm break-words leading-snug" style={{ color: "var(--text)" }}>
              {repo.name}
            </div>
            {repo.branch && <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div ref={upstartMenuRef} className="relative inline-flex">
              <HoverTip
                label={
                  repo.hasUpstart
                    ? "Run .devhub/upstart.sh. Right-click for options."
                    : "Ask OpenCode to create .devhub/upstart.sh and start this repo. Right-click for options."
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setUpstartMenuOpen(false);
                    onUpstart(repo);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setUpstartMenuOpen(true);
                  }}
                  className="btn btn-primary"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                  aria-haspopup="menu"
                  aria-expanded={upstartMenuOpen}
                >
                  <Rocket size={12} /> Upstart
                </button>
              </HoverTip>
              {upstartMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border p-1 shadow-xl"
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
            <button
              type="button"
              onClick={() => onLearn(repo)}
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              <Brain size={12} /> Learn
            </button>
            <HoverTip label="Ask OpenCode to run a developer-experience audit (dx-audit skill) and save the report to notes.">
              <button
                type="button"
                onClick={() => onDxAudit(repo)}
                className="btn btn-ghost"
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                <ClipboardCheck size={12} /> DX Audit
              </button>
            </HoverTip>
          </div>
        </div>
        <div className="mt-2">
          <RepoGitActions
            repoName={repo.name}
            dirtyCount={repo.dirtyCount}
            unpushedCount={repo.unpushedCount ?? 0}
            onMutate={onRefreshLocal}
          />
        </div>
        <div className="mt-2 truncate text-xs font-mono" style={{ color: "var(--text-subtle)" }} title={repo.path}>
          {repo.path}
        </div>

        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={smallButtonStyle}>
              <ExternalLink size={12} /> GitHub
            </a>
          )}
          <RepoBranchPanel repoName={repo.name} onMutate={onRefreshLocal} />
          <LaunchMenu
            label="AI"
            icon={<Bot size={12} aria-hidden />}
            buttonStyle={smallButtonStyle}
            items={[
              {
                id: "opencode-cli",
                label: "OpenCode CLI",
                description: "Open OpenCode in this repo terminal.",
                icon: <TerminalSquare size={13} />,
                onSelect: () =>
                  openTerminal({
                    cwd: repo.path,
                    label: `OpenCode · ${repo.name}`,
                    command: opencodeCliCommand(),
                  }),
              },
              {
                id: "claude-cli",
                label: "Claude CLI",
                description: "Open Claude in this repo terminal.",
                icon: <TerminalSquare size={13} />,
                onSelect: () =>
                  openTerminal({
                    cwd: repo.path,
                    label: `Claude · ${repo.name}`,
                    command: claudeCliCommand(),
                  }),
              },
              {
                id: "claude-app",
                label: "Claude app",
                description: "Open Claude desktop/web for manual handoff.",
                icon: <Bot size={13} />,
                onSelect: onClaudeDesktop,
              },
            ]}
          />
          {isDesktop && (
            <button type="button" onClick={() => onTerminal(repo)} className="btn btn-ghost" style={smallButtonStyle}>
              <TerminalSquare size={12} /> Terminal
            </button>
          )}
          {isDesktop && apps?.gitkraken && (
            <button type="button" onClick={() => onGitKraken(repo.name)} className="btn btn-ghost" style={smallButtonStyle}>
              <GitBranch size={12} /> Kraken
            </button>
          )}
          {isDesktop && (
            <button
              type="button"
              onClick={() => onCursor(repo.name)}
              disabled={opening !== null || removing !== null}
              className="btn btn-ghost"
              style={smallButtonStyle}
            >
              <MonitorPlay size={12} />
              {opening === repo.name ? "Opening..." : "Cursor"}
            </button>
          )}
          <HoverTip
            label={
              removing === repo.name
                ? "Removing..."
                : removing !== null || opening !== null
                  ? "Another repo operation is in progress."
                  : "Delete local clone only"
            }
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ ...smallButtonStyle, color: "var(--danger)" }}
              disabled={removing !== null || opening !== null}
              onClick={() => onRemove(repo.name)}
            >
              <Trash2 size={12} />
              {removing === repo.name ? "Removing..." : "Remove"}
            </button>
          </HoverTip>
        </div>
      </div>
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
