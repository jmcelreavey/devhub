"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpFromLine,
  Bot,
  Brain,
  Container,
  Download,
  ExternalLink,
  GitBranch,
  Monitor,
  MonitorPlay,
  Search,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { HoverTip } from "@/components/HoverTip";
import { LaunchMenu } from "@/components/LaunchMenu";
import { claudeCliCommand, opencodeCliCommand, openTerminal } from "@/lib/terminal-launch";
import type { GithubRepoInfo, RepoInfo } from "./types";

interface RepoApps {
  gitkraken: boolean;
  docker: boolean;
}

interface LocalRepoCardProps {
  repo: RepoInfo;
  githubUrl: string | null;
  apps?: RepoApps;
  isDesktop: boolean;
  opening: string | null;
  removing: string | null;
  composing: string | null;
  onLearn: (repo: RepoInfo) => void;
  onTerminal: (repo: RepoInfo) => void;
  onGitKraken: (name: string) => void;
  onCompose: (name: string) => void;
  onCursor: (name: string) => void;
  onClaudeDesktop: () => void | Promise<void>;
  onRemove: (name: string) => void;
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
}: {
  label: string;
  value: number;
  tone: "muted" | "warning" | "accent" | "success";
  icon: ReactNode;
}) {
  const badgeClass =
    tone === "warning" ? "badge-warning" : tone === "accent" ? "badge-accent" : tone === "success" ? "badge-success" : "badge-muted";
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>{label}</div>
        <span style={{ color: "var(--text-subtle)" }}>{icon}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xl font-semibold" style={{ color: "var(--text)" }}>{value}</span>
        <span className={`badge ${badgeClass}`}>{value === 0 ? "quiet" : "needs eyes"}</span>
      </div>
    </div>
  );
}

export function OpenChamberCard() {
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/status/services")
      .then((r) => r.json())
      .then((data) => setRunning(data?.openchamber?.active ?? false))
      .catch(() => setRunning(false));
  }, []);

  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>OpenChamber</div>
        <Monitor size={13} style={{ color: "var(--text-subtle)" }} aria-hidden />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm" style={{ color: running ? "var(--success)" : "var(--text-muted)" }}>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: running ? "var(--success)" : "var(--text-subtle)" }}
          />
          {running ? "Running" : "Offline"}
        </span>
        <Link href="/chamber" className="btn btn-ghost" style={{ fontSize: "12px", padding: "3px 8px" }}>
          Open
        </Link>
      </div>
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
  composing,
  onLearn,
  onTerminal,
  onGitKraken,
  onCompose,
  onCursor,
  onClaudeDesktop,
  onRemove,
}: LocalRepoCardProps) {
  const hasUnpushed = (repo.unpushedCount ?? 0) > 0;
  const statusTone = repo.dirtyCount > 0 ? "var(--warning)" : hasUnpushed ? "var(--accent)" : "var(--success)";
  return (
    <div className="card" style={{ padding: 0, overflow: "visible", borderLeft: `3px solid ${statusTone}` }}>
      <div className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-sm break-words leading-snug" style={{ color: "var(--text)" }}>
                {repo.name}
              </div>
              {repo.branch && <MetaChip icon={<GitBranch size={11} />} label={repo.branch} />}
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {repo.dirtyCount > 0 ? (
                <span className="badge badge-warning">
                  <AlertCircle size={10} /> {repo.dirtyCount} changed
                </span>
              ) : (
                <span className="badge badge-success">clean</span>
              )}
              {hasUnpushed && (
                <span className="repo-unpushed-badge" title="Local commits not on any remote">
                  <ArrowUpFromLine size={10} aria-hidden /> {repo.unpushedCount} unpushed
                </span>
              )}
              {repo.hasCompose && <span className="badge badge-muted">compose</span>}
            </div>
            <div className="mt-2 truncate text-xs font-mono" style={{ color: "var(--text-subtle)" }} title={repo.path}>
              {repo.path}
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:items-end">
            <button
              type="button"
              onClick={() => onLearn(repo)}
              className="btn btn-primary"
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              <Brain size={12} /> Learn
            </button>
            <div className="flex items-center gap-1.5 flex-wrap lg:justify-end">
              {githubUrl && (
                <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={smallButtonStyle}>
                  <ExternalLink size={12} /> GitHub
                </a>
              )}
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
              {isDesktop && apps?.docker && repo.hasCompose && (
                <button type="button" onClick={() => onCompose(repo.name)} disabled={composing !== null} className="btn btn-ghost" style={smallButtonStyle}>
                  <Container size={12} />
                  {composing === repo.name ? "Starting..." : "Compose"}
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
