"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  ClipboardCopy,
  FileDown,
  FileText,
  GraduationCap,
  RefreshCw,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { FetchError } from "@/components/FetchError";
import { RepoLearnTutor } from "@/components/RepoLearnTutor";
import { SidePanel } from "@/components/SidePanel";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { REPO_LEARN_NOT_CONFIGURED_MSG, repoLearnApiPath } from "@/lib/repo-learn-constants";
import { openTerminal, opencodeCliCommand } from "@/lib/terminal-launch";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import type { RepoInfo, RepoLearnApiPayload } from "./types";

export function parseFetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Couldn't load repo learn data.";
  const raw = error.message;
  const marker = ": ";
  const bodyIndex = raw.indexOf(marker);
  if (bodyIndex === -1) return raw;
  const maybeJson = raw.slice(bodyIndex + marker.length).trim();
  try {
    const parsed = JSON.parse(maybeJson) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // fall through
  }
  return raw;
}

export function LearnPanel({
  repo,
  onClose,
}: {
  repo: RepoInfo | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const key = repo ? repoLearnApiPath(repo.name) : null;
  const { data, error, isLoading, mutate } = useLive<RepoLearnApiPayload>(key, { refreshInterval: 0, revalidateOnFocus: false });
  const context = data?.context;
  const artifacts = data?.artifacts;
  const initialLoading = isLoading && !data;

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  async function refreshLearn() {
    if (!repo) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${repoLearnApiPath(repo.name)}?refresh=1`);
      const json = (await res.json()) as RepoLearnApiPayload;
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Refresh failed");
      await mutate(json, { revalidate: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  async function downloadPackZip() {
    if (!repo) return;
    try {
      const res = await fetch(repoLearnApiPath(repo.name, "/pack.zip"));
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${repo.name}-notebooklm-pack.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download pack.");
    }
  }

  function handoffToOpenCode() {
    if (!context || !repo) return;
    void copyText("opencode", context.openCodePrompt);
    openTerminal({
      cwd: repo.path,
      label: `OpenCode · ${repo.name}`,
      command: opencodeCliCommand(),
    });
  }

  const aiBlocked = data && !data.aiConfigured;
  const aiError = data?.code === "error";
  const briefLoading = data?.aiConfigured && !artifacts?.briefMarkdown && !aiError && (initialLoading || refreshing);

  return (
    <SidePanel open={!!repo} onClose={onClose} storageKey="repos-learn-panel-width" defaultWidth={560} minWidth={420} ariaLabel="Repo learning panel">
      <div className="p-4 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>
            <GraduationCap size={13} aria-hidden /> Learn repo
          </div>
          <div className="mt-1 text-lg font-semibold truncate" style={{ color: "var(--text)" }}>{repo?.name}</div>
          <div className="text-xs truncate font-mono" style={{ color: "var(--text-subtle)" }}>
            Local path: {repo?.path}
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close learning panel" style={{ fontSize: 12, padding: "4px 9px" }}>
          <X size={14} />
          Close
        </button>
      </div>

      <div className="p-4 overflow-auto space-y-4">
        {initialLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius)" }} />)}
          </div>
        )}
        {error && (
          <FetchError message={parseFetchErrorMessage(error)} onRetry={() => mutate()} />
        )}
        {context && (
          <>
            {aiBlocked && (
              <div className="card card-body flex gap-2 items-start" style={{ borderColor: "var(--warning)" }}>
                <AlertCircle size={14} style={{ color: "var(--warning)", marginTop: 2 }} aria-hidden />
                <div>
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>AI not configured</div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
                    {REPO_LEARN_NOT_CONFIGURED_MSG} Repo facts below are still available.{" "}
                    <Link href="/setup" className="underline underline-offset-2" style={{ color: "var(--accent)" }}>
                      Open Setup
                    </Link>
                  </p>
                </div>
              </div>
            )}

            <div className="card card-body">
              <div className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>Detected facts</div>
              <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--text-subtle)" }}>{context.headline}</p>
              <div className="flex flex-wrap gap-1.5">
                {context.primaryStack.map((item) => (
                  <FactChip key={item} label={item} />
                ))}
                {context.packageManager && <FactChip label={context.packageManager} />}
                {context.keyDirectories.slice(0, 4).map((dir) => (
                  <FactChip key={dir} label={dir} mono />
                ))}
              </div>
            </div>

            <div className="card card-body">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
                    <Sparkles size={14} aria-hidden /> Generated brief
                  </div>
                  {artifacts && (
                    <p className="mt-1 text-xs" style={{ color: "var(--text-subtle)" }}>
                      {artifacts.cached ? "Cached" : "Fresh"} · {new Date(artifacts.generatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "3px 8px" }}
                  disabled={refreshing || !data?.aiConfigured}
                  onClick={() => void refreshLearn()}
                >
                  <RefreshCw size={12} className={refreshing ? "animate-spin" : undefined} /> Refresh
                </button>
              </div>
              {aiError && (
                <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>{data?.message}</p>
              )}
              {artifacts?.briefMarkdown ? (
                <div className="mt-3 rounded p-3" style={{ background: "var(--bg-elevated)" }}>
                  <SimpleMarkdown text={artifacts.briefMarkdown} compact />
                </div>
              ) : briefLoading ? (
                <div className="mt-3 space-y-1.5">
                  <div className="skeleton" style={{ height: 12, width: "100%" }} />
                  <div className="skeleton" style={{ height: 12, width: "90%" }} />
                </div>
              ) : aiBlocked ? (
                <p className="mt-2 text-xs" style={{ color: "var(--text-subtle)" }}>Brief requires z.ai.</p>
              ) : null}
              {artifacts?.briefMarkdown && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <PanelAction
                    icon={<ClipboardCopy size={12} />}
                    copied={copied === "brief"}
                    label="Copy brief"
                    onClick={() => copyText("brief", artifacts.briefMarkdown)}
                  />
                  <PanelAction
                    icon={<TerminalSquare size={12} />}
                    copied={copied === "opencode"}
                    label="OpenCode handoff"
                    onClick={handoffToOpenCode}
                  />
                </div>
              )}
            </div>

            <div className="card card-body">
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
                <BookOpen size={14} aria-hidden /> Quiz me
              </div>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
                Socratic tutor — answer questions, get follow-ups until something you don&apos;t know gets explained.
              </p>
              <div className="mt-3">
                {repo && <RepoLearnTutor repoName={repo.name} aiConfigured={data?.aiConfigured === true} />}
              </div>
            </div>

            <div className="card card-body">
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
                <FileText size={14} aria-hidden /> NotebookLM source pack
              </div>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
                Download a ZIP of curated Markdown sources. NotebookLM does not accept ZIP natively — use the NotebookLM Tools extension or unzip and upload files manually (free plan: 50 sources).
              </p>
              {artifacts?.packFiles && artifacts.packFiles.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs font-mono" style={{ color: "var(--text-subtle)" }}>
                  {artifacts.packFiles.map((file) => (
                    <li key={file.path}>
                      {file.path} ({formatBytes(file.sizeBytes)})
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <PanelAction
                  icon={<FileDown size={12} />}
                  copied={false}
                  label="Download ZIP"
                  onClick={() => void downloadPackZip()}
                  disabled={!artifacts?.packFiles.length}
                />
                {artifacts?.overviewMarkdown && (
                  <PanelAction
                    icon={<ClipboardCopy size={12} />}
                    copied={copied === "overview"}
                    label="Copy overview"
                    onClick={() => copyText("overview", artifacts.overviewMarkdown!)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}

function FactChip({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <span
      className="badge text-[10px]"
      style={{
        fontFamily: mono ? "var(--font-mono)" : undefined,
        color: "var(--text-subtle)",
      }}
    >
      {label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PanelAction({
  icon,
  label,
  copied,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  copied: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{
        fontSize: 12,
        padding: "4px 9px",
        color: copied ? "var(--success)" : undefined,
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {copied ? <Check size={12} style={{ color: "var(--success)" }} /> : icon}
      {copied ? "Copied" : label}
    </button>
  );
}
