"use client";

import { useEffect, useState, useCallback, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCw, Server, Link2, RotateCw, GitBranch, ArrowUp, ArrowDown, Play, AlertTriangle, Check, Wifi, QrCode, Cloud, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import { CommitMessageModal, defaultCommitCheckpointMessage } from "@/components/CommitMessageModal";
import { getNow, subscribeMinute } from "@/lib/minute-tick";
import { revalidateScriptsHistory } from "@/lib/scripts-history-swr";
import { waitForScriptRun } from "@/lib/wait-for-script-run";
import { formatRelativePastAge } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ConflictResolverPanel } from "@/components/ConflictResolverPanel";
import { SyncHealthPanel } from "@/components/SyncHealthPanel";
import { StatusDot } from "@/components/StatusDot";
import { CopyButton } from "@/components/CopyButton";
import { HoverTip } from "@/components/HoverTip";
import { useLive } from "@/lib/use-fetch";
import type { SetupGateStatus } from "@/lib/nav";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";

interface ServiceInfo {
  name: string;
  active: boolean;
  uptime: string | null;
}

interface ServicesStatus {
  openchamber: ServiceInfo;
  opencode: ServiceInfo;
}

interface McpRuntimeEntry {
  name: string;
  command: string;
  fingerprint: string;
  binaryExists: boolean;
  runningCount: number;
  pids: number[];
}

interface GitHint {
  severity: "warn" | "error";
  text: string;
  fix?: string;
}

interface GitStatus {
  branch: string;
  dirtyCount: number;
  /** Dirty files that are NOT syncable content (notes/tasks/diagrams/docs). */
  otherDirtyCount?: number;
  /** Dirty syncable content (notes/tasks/diagrams/docs). */
  contentDirtyCount?: number;
  ahead: number;
  behind: number;
  conflictCount?: number;
  lastCommit: { hash: string; authoredAt: number; message: string };
  hints?: GitHint[];
}

interface ScriptRunResponse {
  runId: string;
}

interface ScriptHistoryEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

interface ScriptRunLogPayload {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
}

interface FailedSyncRun {
  entry: ScriptHistoryEntry;
  log: ScriptRunLogPayload;
}

async function fetchStatusRows(): Promise<
  [ServicesStatus, GitStatus | null, { servers: McpRuntimeEntry[] }, { addresses: unknown }]
> {
  return Promise.all([
    fetch("/api/status/services").then((r) => r.json()),
    fetch("/api/status/git").then((r) => r.json()).catch(() => null),
    fetch("/api/status/mcp")
      .then((r) => r.json())
      .catch(() => ({ servers: [] })) as Promise<{ servers: McpRuntimeEntry[] }>,
    fetch("/api/status/lan")
      .then((r) => (r.ok ? r.json() : { addresses: [] }))
      .catch(() => ({ addresses: [] })) as Promise<{ addresses: unknown }>,
  ]);
}

function normalizeLanAddresses(lan: { addresses: unknown }): string[] {
  return Array.isArray(lan.addresses)
    ? lan.addresses.filter((a): a is string => typeof a === "string" && a.length > 0)
    : [];
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-widest px-0.5" style={{ color: "var(--text-subtle)", letterSpacing: "0.12em" }}>
      {children}
    </div>
  );
}

/** MCP: running = green, idle = neutral (not an error), missing binary = warning. */
function McpStateDot({ running, binaryMissing }: { running: boolean; binaryMissing: boolean }) {
  const background = running
    ? "var(--success)"
    : binaryMissing
      ? "var(--warning)"
      : "var(--text-subtle)";
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-black/20"
      style={{ background }}
      title={running ? "Process detected" : binaryMissing ? "Command binary missing" : "No matching process (normal when idle)"}
      aria-hidden
    />
  );
}

function ServiceCard({ info, onRestart, restarting }: {
  info: ServiceInfo;
  onRestart: () => void;
  restarting: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot ok={info.active} />
        <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{info.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {info.uptime && (
          <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
            since {info.uptime}
          </span>
        )}
        <span className={`badge ${info.active ? "badge-success" : "badge-danger"}`}>
          {info.active ? "running" : "stopped"}
        </span>
        <HoverTip label={restarting ? `Restarting ${info.name}…` : `Restart ${info.name}`}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: "11px", padding: "2px 6px" }}
            onClick={onRestart}
            disabled={restarting}
          >
            <RotateCw size={11} className={restarting ? "animate-spin" : ""} />
          </button>
        </HoverTip>
      </div>
    </div>
  );
}

interface BiSnapshot {
  awsProfile: string | null;
  awsIdentity: { account: string; arn: string } | null;
  kubeContext: string | null;
}

/**
 * Compact infra snapshot: AWS profile + identity + current Kubernetes context.
 * Surfaces whether the dashboard process has working AWS credentials and links to
 * /ops for the full controls (provided by an infra plugin when installed).
 */
function InfraCard() {
  const [snapshot, setSnapshot] = useState<BiSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/bi");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = (await r.json()) as BiSnapshot;
        if (!cancelled) setSnapshot(data);
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const authed = Boolean(snapshot?.awsIdentity);
  const profile = snapshot?.awsProfile ?? null;
  const ctx = snapshot?.kubeContext ?? null;

  return (
    <div className="card min-w-0 flex flex-col">
      <div className="card-header">
        <span className="flex items-center gap-1.5"><Cloud size={12} />Infra</span>
        <Link
          href="/ops"
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
          title="Open Ops page"
        >
          Ops <ExternalLink size={10} aria-hidden />
        </Link>
      </div>
      <div className="card-body flex-1" style={{ padding: "8px 16px" }}>
        {!loaded ? (
          <p className="text-xs py-2" style={{ color: "var(--text-subtle)" }}>Loading…</p>
        ) : (
          <div className="flex flex-col gap-1.5 py-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <StatusDot ok={authed} />
                <span style={{ color: "var(--text)" }}>AWS</span>
              </span>
              {profile ? (
                <span className="flex items-center gap-2">
                  <code className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{profile}</code>
                  <span className={`badge ${authed ? "badge-success" : "badge-muted"}`}>
                    {authed ? "signed in" : "expired"}
                  </span>
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>not set</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <StatusDot ok={Boolean(ctx)} />
                <span style={{ color: "var(--text)" }}>kubectl</span>
              </span>
              {ctx ? (
                <code className="font-mono text-[11px] truncate" style={{ color: "var(--text-muted)", maxWidth: 180 }} title={ctx}>
                  {ctx}
                </code>
              ) : (
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>no context</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StatusPage() {
  const tickNow = useSyncExternalStore(subscribeMinute, getNow, () => 0);
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 60_000 });
  const showChamber = setup?.chamber === true;
  const showOpenCode = setup?.opencode === true;
  const [services, setServices] = useState<ServicesStatus | null>(null);
  const [mcpRuntime, setMcpRuntime] = useState<McpRuntimeEntry[]>([]);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const boot = useBootGate(!loading);
  const [refreshed, setRefreshed] = useState(0);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDirtyModal, setSyncDirtyModal] = useState<{ dirtyCount: number } | null>(null);
  const [latestFailedSyncRun, setLatestFailedSyncRun] = useState<FailedSyncRun | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [copiedLanUrl, setCopiedLanUrl] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const loadLatestSyncFailure = useCallback(async () => {
    const history = await fetch("/api/scripts/history")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []) as ScriptHistoryEntry[];

    // History is newest-first. Show a failure only when the *latest* sync-related
    // run failed — not an older failure after intervening successes or other scripts.
    const latestSyncRelated = history.find(
      (entry) => entry.script === "commit_dirty_push" || entry.script === "update_and_sync",
    );
    if (
      !latestSyncRelated ||
      latestSyncRelated.exitCode == null ||
      latestSyncRelated.exitCode === 0
    ) {
      setLatestFailedSyncRun(null);
      return;
    }

    const log = await fetch(`/api/scripts/runs/${latestSyncRelated.runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as ScriptRunLogPayload | null;

    if (!log || !Array.isArray(log.lines)) {
      setLatestFailedSyncRun(null);
      return;
    }
    setLatestFailedSyncRun({ entry: latestSyncRelated, log });
  }, []);

  const applyStatusRows = useCallback(
    (
      [svc, g, m, lan]: [
        ServicesStatus,
        GitStatus | null,
        { servers: McpRuntimeEntry[] },
        { addresses: unknown },
      ],
      gitPolicy: "always" | "ifTruthy",
    ) => {
      setServices(svc);
      if (gitPolicy === "always") setGit(g);
      else if (g) setGit(g);
      setMcpRuntime(Array.isArray(m?.servers) ? m.servers : []);
      setLanAddresses(normalizeLanAddresses(lan));
      void loadLatestSyncFailure();
    },
    [loadLatestSyncFailure],
  );

  const reload = useCallback(() => {
    setLoading(true);
    void fetchStatusRows()
      .then((rows) => applyStatusRows(rows, "always"))
      .finally(() => setLoading(false));
  }, [applyStatusRows]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching external data on refresh
  useEffect(() => { reload(); }, [refreshed, reload]);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchStatusRows().then((rows) => applyStatusRows(rows, "ifTruthy"));
    }, 30_000);
    return () => clearInterval(interval);
  }, [applyStatusRows]);

  async function restartService(service: string) {
    setRestarting(service);
    try {
      await fetch("/api/status/services/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      setTimeout(() => setRefreshed((n) => n + 1), 2000);
    } finally {
      setRestarting(null);
    }
  }

  async function quickSync() {
    const latestGit = await fetch("/api/status/git")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as GitStatus | null;

    if (latestGit?.dirtyCount && latestGit.dirtyCount > 0) {
      setSyncDirtyModal({ dirtyCount: latestGit.dirtyCount });
      return;
    }

    setSyncing(true);
    try {
      const syncStart = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "update_and_sync" }),
      });
      if (!syncStart.ok) throw new Error("Could not start Update & Sync.");
      const { runId } = await syncStart.json() as ScriptRunResponse;
      const syncCode = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (syncCode !== 0) throw new Error(`Update & Sync failed (exit ${syncCode}).`);
      setTimeout(() => setRefreshed((n) => n + 1), 5000);
    } finally {
      setSyncing(false);
    }
  }

  async function quickSyncAfterCommit(commitMessage: string) {
    setSyncing(true);
    try {
      const commitStart = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: "commit_dirty_push",
          commitMessage,
        }),
      });
      if (!commitStart.ok) throw new Error("Could not start Commit & Push action.");
      const { runId: commitRunId } = await commitStart.json() as ScriptRunResponse;
      const commitCode = await waitForScriptRun(commitRunId);
      revalidateScriptsHistory();
      if (commitCode !== 0) throw new Error(`Commit & Push failed (exit ${commitCode}).`);

      const syncStart = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: "update_and_sync" }),
      });
      if (!syncStart.ok) throw new Error("Could not start Update & Sync.");
      const { runId } = await syncStart.json() as ScriptRunResponse;
      const syncCode = await waitForScriptRun(runId);
      revalidateScriptsHistory();
      if (syncCode !== 0) throw new Error(`Update & Sync failed (exit ${syncCode}).`);
      setTimeout(() => setRefreshed((n) => n + 1), 5000);
    } finally {
      setSyncing(false);
    }
  }

  function buildChamberPrompt(failure: FailedSyncRun): string {
    const excerpt = failure.log.lines.slice(-120).join("\n");
    return [
      "Fix the push blockers in this repo.",
      "",
      "Context:",
      "- Checkout: your DevHub repository root (the folder you have open in the editor).",
      `- Failed action: ${failure.entry.script}`,
      `- Run ID: ${failure.entry.runId}`,
      `- Exit code: ${failure.entry.exitCode ?? failure.log.exitCode ?? 1}`,
      "",
      "Goal:",
      "- Make minimal code changes to resolve the failing verify/pre-push checks.",
      "- Run the project verification command used by pre-push and confirm it is clean.",
      "- Do not bypass hooks.",
      "",
      "Recent action log output:",
      "```",
      excerpt || "(no output captured)",
      "```",
    ].join("\n");
  }

  /**
   * Next `next dev` is plain HTTP on the LAN IP. If this tab was opened through
   * an HTTPS reverse proxy, `location.protocol` is `https:` but the phone must
   * use `http://<ip>:<port>` to hit the dev server directly.
   */
  function buildLanDashboardUrl(ip: string): string {
    const loc = new URL(window.location.href);
    const portPart = loc.port ? `:${loc.port}` : "";
    return `http://${ip}${portPart}${loc.pathname}${loc.search}`;
  }

  async function copyLanDashboardUrl() {
    const ip = lanAddresses[0];
    if (!ip) return;
    try {
      await copyTextToClipboard(buildLanDashboardUrl(ip));
      setCopiedLanUrl(true);
      window.setTimeout(() => setCopiedLanUrl(false), 1500);
    } catch {
      setCopiedLanUrl(false);
    }
  }

  async function toggleQrCode() {
    if (showQrCode) {
      setShowQrCode(false);
      return;
    }
    const ip = lanAddresses[0];
    if (!ip) return;
    const url = buildLanDashboardUrl(ip);
    try {
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 180 });
      setQrDataUrl(dataUrl);
      setShowQrCode(true);
    } catch {
      setQrDataUrl(null);
      setShowQrCode(false);
    }
  }

  // Health summary — aggregated across all loaded data
  const healthItems: string[] = [];
  if (services) {
    const visible = [
      showChamber ? services.openchamber : null,
      showOpenCode ? services.opencode : null,
    ].filter((s): s is ServiceInfo => !!s);
    const stopped = visible.filter((s) => !s.active).length;
    if (stopped > 0) healthItems.push(`${stopped} service${stopped > 1 ? "s" : ""} stopped`);
  }
  // Content (notes/tasks/diagrams/docs) has a one-tap sync and is tracked
  // separately from genuine "dirty files" that need commit & push.
  const otherDirty = git ? (git.otherDirtyCount ?? git.dirtyCount) : 0;
  const contentDirty = git ? (git.contentDirtyCount ?? 0) : 0;
  if (git) {
    if (otherDirty > 0) healthItems.push(`${otherDirty} dirty path${otherDirty > 1 ? "s" : ""}`);
    if (git.behind > 0) healthItems.push(`${git.behind} commit${git.behind > 1 ? "s" : ""} behind`);
    if ((git.conflictCount ?? 0) > 0) {
      healthItems.push(`${git.conflictCount} merge conflict${git.conflictCount !== 1 ? "s" : ""}`);
    }
    if (git.hints?.some((h) => h.severity === "error")) healthItems.push("git errors");
  }
  const mcpMissing = mcpRuntime.filter((s) => !s.binaryExists).length;
  if (mcpMissing > 0) healthItems.push(`${mcpMissing} MCP binary missing`);
  if (latestFailedSyncRun) healthItems.push("last sync failed");
  const allGreen = !loading && healthItems.length === 0;

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <CommitMessageModal
        open={syncDirtyModal !== null}
        onClose={() => setSyncDirtyModal(null)}
        title="Uncommitted changes"
        description={
          syncDirtyModal
            ? `Working tree has ${syncDirtyModal.dirtyCount} changed path(s). Enter a commit message to stage, commit, push to origin, then run Update & Sync.`
            : undefined
        }
        defaultMessage={defaultCommitCheckpointMessage()}
        confirmLabel="Commit, push & sync"
        variant="warning"
        onConfirm={(msg) => {
          setSyncDirtyModal(null);
          void quickSyncAfterCommit(msg);
        }}
      />
      <div className="page-header">
        <div className="page-title">Status</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {lanAddresses.length > 0 && (
            <div className="relative">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost max-w-[min(100%,14rem)] sm:max-w-none"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                  onClick={() => void copyLanDashboardUrl()}
                  title={
                    lanAddresses.length > 1
                      ? `Copy this page's URL using LAN IP (${lanAddresses.join(", ")}). Phone must be on the same Wi-Fi.`
                      : "Copy this page's URL for opening on your phone (same Wi-Fi)."
                  }
                >
                  {copiedLanUrl ? <Check size={12} aria-hidden /> : <Wifi size={12} aria-hidden />}
                  <span className="truncate font-mono tabular-nums">
                    {copiedLanUrl ? "Copied" : lanAddresses[0]}
                  </span>
                  {lanAddresses.length > 1 && !copiedLanUrl && (
                    <span className="shrink-0 tabular-nums opacity-70" aria-hidden>
                      +{lanAddresses.length - 1}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost ${showQrCode ? "btn-primary" : ""}`}
                  style={{ fontSize: "12px", padding: "4px 6px" }}
                  onClick={() => void toggleQrCode()}
                  title="Show QR code for phone scan"
                  aria-pressed={showQrCode}
                >
                  <QrCode size={12} aria-hidden />
                </button>
              </div>
              {showQrCode && qrDataUrl && (
                <div
                  className="absolute right-0 z-50 mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl"
                  role="tooltip"
                >
                  <p className="mb-1.5 text-center text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                    Scan to open on phone
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated client-side, cannot use next/image */}
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${buildLanDashboardUrl(lanAddresses[0])}`}
                    className="block rounded bg-white p-1"
                    width={180}
                    height={180}
                  />
                  <p className="mt-1.5 truncate text-center text-[10px] font-mono tabular-nums" style={{ color: "var(--text-subtle)" }}>
                    {lanAddresses[0]}
                  </p>
                </div>
              )}
            </div>
          )}
          {git !== null && git.dirtyCount > 0 && (
            <HoverTip label={syncing ? "Syncing…" : "Stage, commit, push, then run Update & Sync"}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: "12px", padding: "4px 10px" }}
                onClick={() => setSyncDirtyModal({ dirtyCount: git.dirtyCount })}
                disabled={syncing}
              >
                <AlertTriangle size={12} />
                Commit &amp; sync…
              </button>
            </HoverTip>
          )}
          <HoverTip
            label={
              syncing
                ? "Syncing…"
                : git !== null && git.dirtyCount > 0
                  ? "Opens commit flow when the tree is dirty, then runs Update & Sync"
                  : "Run Update & Sync (pull + related steps)"
            }
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={quickSync}
              disabled={syncing}
            >
              <Play size={12} className={syncing ? "animate-pulse" : ""} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </HoverTip>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => setRefreshed((n) => n + 1)}
            disabled={loading}
            aria-label="Refresh status"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Health summary */}
      {!loading && (
        <div
          className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md text-sm"
          style={{
            background: allGreen ? "var(--success-dim)" : "var(--bg-elevated)",
            border: `1px solid ${allGreen ? "var(--success)" : "var(--warning)"}`,
          }}
        >
          {allGreen ? (
            <>
              <Check size={13} style={{ color: "var(--success)" }} aria-hidden />
              <span style={{ color: "var(--success)" }}>All green</span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} style={{ color: "var(--warning)" }} aria-hidden />
              <span style={{ color: "var(--text-muted)" }}>{healthItems.join(" · ")}</span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {git && (
          <>
          <div className="card min-w-0 flex flex-col">
            <div className="card-header">
              <span className="flex items-center gap-1.5"><GitBranch size={12} />Repo</span>
            </div>
            <div className="card-body flex flex-1 flex-col gap-3">
              <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2">
                <div className="flex min-h-[1.75rem] items-center justify-between gap-3 border-b border-[var(--border-muted)] pb-2 sm:border-b-0 sm:pb-0">
                  <span className="text-[13px] font-medium tracking-tight" style={{ color: "var(--text-muted)" }}>
                    Branch
                  </span>
                  <span className="truncate font-mono text-xs tabular-nums" style={{ color: "var(--text)" }} title={git.branch}>
                    {git.branch}
                  </span>
                </div>
                <div
                  className="flex min-h-[1.75rem] items-center justify-between gap-3 border-b border-[var(--border-muted)] pb-2 sm:border-b-0 sm:pb-0"
                  title="Dirty files needing commit & push. Notes/tasks/diagrams are tracked separately as syncable content."
                >
                  <span className="text-[13px] font-medium tracking-tight" style={{ color: "var(--text-muted)" }}>
                    Dirty paths
                  </span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <span
                      className="tabular-nums font-semibold"
                      style={{ color: otherDirty > 0 ? "var(--warning)" : "var(--success)" }}
                    >
                      {otherDirty}
                    </span>
                    {contentDirty > 0 && (
                      <span className="tabular-nums text-[11px]" style={{ color: "var(--accent)" }}>
                        +{contentDirty} content
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="flex min-h-[1.75rem] items-center justify-between gap-3 border-b border-[var(--border-muted)] pb-2 sm:border-b-0 sm:pb-0"
                  title="Compared to your upstream branch (usually origin/main). ↑ = local commits not pushed yet. ↓ = remote commits not pulled yet."
                >
                  <span className="text-[13px] font-medium tracking-tight" style={{ color: "var(--text-muted)" }}>
                    vs upstream
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs">
                    {git.ahead > 0 && (
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap" style={{ color: "var(--accent)" }} title="Unpushed local commits">
                        <ArrowUp size={10} aria-hidden />
                        {git.ahead} to push
                      </span>
                    )}
                    {git.behind > 0 && (
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap" style={{ color: "var(--warning)" }} title="Commits on remote you do not have locally">
                        <ArrowDown size={10} aria-hidden />
                        {git.behind} behind
                      </span>
                    )}
                    {git.ahead === 0 && git.behind === 0 && (
                      <span className="whitespace-nowrap" style={{ color: "var(--success)" }}>
                        up to date
                      </span>
                    )}
                  </span>
                </div>
                {git.lastCommit && (
                  <div className="flex min-h-[1.75rem] items-start justify-between gap-3 sm:col-span-2">
                    <span className="shrink-0 pt-0.5 text-[13px] font-medium tracking-tight" style={{ color: "var(--text-muted)" }}>
                      Last commit
                    </span>
                    <span
                      className="text-right font-mono text-[11px] leading-snug break-all"
                      style={{ color: "var(--text-subtle)" }}
                      title={new Date(git.lastCommit.authoredAt * 1000).toLocaleString()}
                    >
                      <span className="text-[var(--text-muted)]">{git.lastCommit.hash}</span>
                      {" · "}
                      {tickNow === 0
                        ? "recently"
                        : formatRelativePastAge(Math.max(0, tickNow - git.lastCommit.authoredAt * 1000))}
                    </span>
                  </div>
                )}
              </div>

              {git.dirtyCount > 0 && (
                <div
                  className="flex flex-col gap-2 rounded-md border border-[var(--border)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  style={{ background: "var(--warning-dim)" }}
                >
                  <p className="text-xs leading-snug" style={{ color: "var(--text)" }}>
                    {otherDirty > 0
                      ? "Automated sync is paused until these changes are committed (or discarded)."
                      : "Notes, tasks, and diagrams have unsynced changes — sync them (cloud button in the top bar) before automated sync resumes."}
                  </p>
                </div>
              )}

              {latestFailedSyncRun && (
                <div
                  className="rounded-md border border-[var(--border)] px-3 py-2.5"
                  style={{ background: "var(--danger-dim)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                        Last sync/commit action failed ({latestFailedSyncRun.entry.script}).
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Run <span className="font-mono">{latestFailedSyncRun.entry.runId}</span> exited with code{" "}
                        {latestFailedSyncRun.entry.exitCode ?? latestFailedSyncRun.log.exitCode ?? "1"}.
                      </p>
                    </div>
                    <CopyButton
                      text={latestFailedSyncRun ? buildChamberPrompt(latestFailedSyncRun) : ""}
                      label="Chamber prompt"
                    />
                  </div>
                  <pre
                    className="mt-2 rounded border border-[var(--border-muted)] p-2 text-[11px] font-mono leading-snug"
                    style={{
                      color: "var(--text-muted)",
                      background: "var(--bg)",
                      maxHeight: "10rem",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {latestFailedSyncRun.log.lines.slice(-12).join("\n")}
                  </pre>
                </div>
              )}

              {(() => {
                const extraHints =
                  git.hints?.filter(
                    (h) =>
                      !(
                        git.dirtyCount > 0 &&
                        (h.text.startsWith("Working tree has dirty files") ||
                          h.text.startsWith("Notes, tasks, and diagrams have unsynced"))
                      ),
                  ) ?? [];
                if (extraHints.length === 0) return null;
                return (
                <details
                  className="group rounded-md text-xs"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                  }}
                  open={extraHints.some((h) => h.severity === "error")}
                >
                  <summary
                    className="cursor-pointer list-none px-3 py-2 font-semibold outline-none marker:content-none [&::-webkit-details-marker]:hidden"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <span className="inline-flex w-full items-center justify-between gap-2">
                      <span style={{ color: "var(--text)" }}>Git notices</span>
                      <span className="text-[11px] font-normal tabular-nums" style={{ color: "var(--text-subtle)" }}>
                        {extraHints.length} item{extraHints.length === 1 ? "" : "s"} · expand for details
                      </span>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-[var(--border-muted)] px-3 py-3">
                    {extraHints.map((h, i) => (
                      <div key={i} className="space-y-1.5">
                        <p style={{ color: h.severity === "error" ? "var(--danger)" : "var(--warning)" }}>{h.text}</p>
                        {h.fix && (
                          <p className="leading-relaxed" style={{ color: "var(--text-muted)" }}>
                            {h.fix}
                          </p>
                        )}
                      </div>
                    ))}
                    <p className="border-t border-[var(--border-muted)] pt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-subtle)" }}>
                      After you resolve blockers, use <strong className="font-medium" style={{ color: "var(--text-muted)" }}>Sync</strong> on this page or run <strong className="font-medium" style={{ color: "var(--text-muted)" }}>Update &amp; Sync</strong> from Actions — live output matches what you see there.
                    </p>
                  </div>
                </details>
                );
              })()}
            </div>
          </div>

          <div className="card min-w-0 flex flex-col">
            <div className="card-header">
              <span className="flex items-center gap-1.5"><AlertTriangle size={12} />Merge conflicts</span>
            </div>
            <div className="card-body">
              <ConflictResolverPanel />
            </div>
          </div>
          </>
        )}

        <SectionLabel>Skill sync</SectionLabel>
        <div className="card min-w-0 flex flex-col">
          <div className="card-header"><span className="flex items-center gap-1.5"><Cloud size={12} />Sync health &amp; diff</span></div>
          <div className="card-body"><SyncHealthPanel /></div>
        </div>

        {/* Services + MCP + BI: shared row on large screens */}
        <SectionLabel>Services &amp; Integrations</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        {(showChamber || showOpenCode) && (
        <div className="card min-w-0 flex flex-col">
          <div className="card-header">
            <span className="flex items-center gap-1.5"><Server size={12} />Services</span>
          </div>
          <div className="card-body flex-1" style={{ padding: "8px 16px" }}>
            {services ? (
              <>
                {showChamber && (
                  <ServiceCard
                    info={{ ...services.openchamber, name: "OpenChamber" }}
                    onRestart={() => restartService("openchamber")}
                    restarting={restarting === "openchamber"}
                  />
                )}
                {showOpenCode && services.opencode && (
                  <div style={{ borderTop: showChamber ? "1px solid var(--border-muted)" : undefined }}>
                    <ServiceCard
                      info={{ ...services.opencode, name: "OpenCode" }}
                      onRestart={() => restartService("opencode")}
                      restarting={restarting === "opencode"}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs py-2" style={{ color: "var(--text-subtle)" }}>Loading…</p>
            )}
          </div>
        </div>
        )}

        <div className="card min-w-0 flex flex-col">
          <div className="card-header">
            <span className="flex items-center gap-1.5"><Link2 size={12} />MCP Servers</span>
          </div>
          <div
            className="card-body flex-1 min-h-0 overflow-y-auto max-h-[min(50vh,24rem)] lg:max-h-none"
            style={{ padding: "8px 16px" }}
          >
            {mcpRuntime.length === 0 ? (
              <p className="text-xs py-2" style={{ color: "var(--text-subtle)" }}>
                No servers under <code>mcp/shared/</code>.
              </p>
            ) : (
              mcpRuntime.map((srv, i) => {
                const isRunning = srv.runningCount > 0;
                const binaryMissing = !srv.binaryExists;
                const badgeClass = isRunning ? "badge-success" : binaryMissing ? "badge-warning" : "badge-muted";
                const badgeText = isRunning ? `running · ${srv.runningCount} proc${srv.runningCount > 1 ? "s" : ""}` : binaryMissing ? "binary missing" : "idle";
                return (
                  <div
                    key={srv.name}
                    className="flex items-center justify-between py-2 text-sm"
                    style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-muted)" }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <McpStateDot running={isRunning} binaryMissing={binaryMissing} />
                      <span className="font-medium font-mono min-w-0 truncate" style={{ color: "var(--text)" }} title={binaryMissing ? `binary missing: ${srv.command}` : srv.name}>{srv.name}</span>
                    </div>
                    <span className={`badge shrink-0 ${badgeClass}`} title={isRunning && srv.pids.length ? `pids: ${srv.pids.join(", ")}` : binaryMissing ? `command: ${srv.command}` : "no matching processes"}>
                      {badgeText}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <InfraCard />
        </div>

      </div>
    </div>
  );
}
