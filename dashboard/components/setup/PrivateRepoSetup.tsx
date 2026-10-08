"use client";

import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { CopyButton } from "@/components/ui/CopyButton";
import { FolderOpen, RotateCcw } from "lucide-react";
import { pickFolder, isDesktop } from "@/lib/desktop/bridge";
import type { GitCheck } from "@/lib/setup/git-check";

interface RepoStatus {
  directory: string; linked: boolean; url?: string; error?: string; existing?: boolean;
  /** Something is already at `directory` (a checkout or not). */
  folderExists?: boolean;
  remote?: { repository: string; exists: boolean; isPrivate: boolean; empty: boolean };
  suggestion?: { name: string; directory: string };
}

type Plan = "create" | "clone" | "link" | "blocked";

/**
 * What the one-click default can do here. The create button only appears when
 * it can succeed; otherwise the matching action leads, instead of a button that
 * fails with "already exists".
 */
export function planFor(status: RepoStatus | undefined): Plan {
  if (status?.existing) return "link";
  if (status?.folderExists) return "blocked";
  if (status?.remote?.exists && !status.remote.empty) return "clone";
  return "create";
}

const DEFAULT_REPO_NAME = "devhub-private";

/** Git is missing: say where to run what, with a copy button and a re-check. */
function GitMissing({ git, onRecheck, checking }: { git: GitCheck; onRecheck: () => void; checking: boolean }) {
  return (
    <div className="tone-panel tone-panel--warning flex flex-col gap-2 p-3 text-sm" role="alert">
      <p className="font-medium">Git isn&apos;t installed yet</p>
      <p>
        A private repo needs Git. Everything else in DevHub works without it, so you can skip this and come back.
      </p>
      {git.installCommand ? (
        <>
          <p>Run this in {git.where}:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded px-2 py-1 text-xs" style={{ background: "var(--bg)" }}>{git.installCommand}</code>
            <CopyButton text={git.installCommand} label="install command" showLabel />
          </div>
        </>
      ) : (
        <p>Install it from <a className="underline" href={git.installUrl} target="_blank" rel="noopener noreferrer">{git.installUrl.replace(/^https?:\/\//, "")}</a>.</p>
      )}
      <button type="button" className="btn btn-ghost self-start" disabled={checking} onClick={onRecheck}>
        <RotateCcw size={12} /> Re-check Git
      </button>
    </div>
  );
}

export function PrivateRepoSetup({ connected, onLinked, onLater }: { connected: boolean; onLinked: () => void; onLater?: () => void }) {
  const { data: git, mutate: recheckGit, isLoading: checkingGit } = useLive<GitCheck>("/api/setup/git", { refreshInterval: 0 });
  const gitMissing = git !== undefined && !git.present;
  const { data, error: fetchError, isLoading: checking, mutate } = useLive<RepoStatus>(
    connected ? "/api/setup/private-repo" : null, { refreshInterval: 0 },
  );
  const plan = planFor(data);
  const [chosenAction, setAction] = useState<"create" | "clone" | "link" | null>(null);
  const action = chosenAction ?? (plan === "link" || plan === "clone" ? plan : "create");
  const [name, setName] = useState(DEFAULT_REPO_NAME);
  const [chosenRepository, setRepository] = useState<string | null>(null);
  const repository = chosenRepository ?? (plan === "clone" ? data?.remote?.repository : undefined) ?? "";
  const [chosenDirectory, setDirectory] = useState<string | null>(null);
  const directory = chosenDirectory ?? data?.directory ?? "";
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const error = actionError || fetchError?.message || data?.error || "";
  const [connectedRepo, setLinked] = useState<RepoStatus | null>(null);
  const linked = connectedRepo ?? (data?.linked ? data : null);
  const [restartRequired, setRestartRequired] = useState(false);

  async function submit(request: { action: "create" | "clone" | "link"; directory: string; name?: string; repository?: string }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/private-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: request.action, directory: request.directory,
          ...(request.action === "create" ? { name: request.name } : request.action === "clone" ? { repository: request.repository } : {}),
        }),
      });
      const result: RepoStatus = await response.json();
      if (!response.ok) throw new Error(result.error || "Private repository setup failed.");
      setLinked({ ...result, linked: true });
      setRestartRequired(true);
      onLinked();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const ready = connected && !gitMissing && !checking && Boolean(data);
  return (
    <section className="mt-6 flex flex-col gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">Back up to a private GitHub repo</h3>
        <span className="badge badge-muted">Optional</span>
      </div>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        DevHub works fully on this PC without it: notes, tasks and diagrams are saved in DevHub&apos;s data folder.
        A private repo adds a backup, history, and a way to use the same content on another machine.
        You don&apos;t fork anything. DevHub makes a private copy in your own GitHub account (a fork of a public repo would
        stay public), and app updates still come from DevHub releases.
      </p>
      {gitMissing && git && <GitMissing git={git} checking={checkingGit} onRecheck={() => void recheckGit()} />}
      {!connected ? (
        <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Sign in with GitHub above to connect a private repo. GitHub CLI comes with DevHub. You can also skip this and connect one later from Setup → GitHub.</p>
      ) : checking ? <SkeletonRows count={3} height={40} /> : linked ? (
        <div className="tone-panel tone-panel--accent p-3 text-sm">
          <p>Private repo linked: <a className="text-accent" href={linked.url} target="_blank" rel="noopener noreferrer">{linked.url}</a></p>
          <p className="mt-1 font-mono text-xs break-all">{linked.directory}</p>
          {restartRequired && <p className="mt-2">Quit and reopen DevHub to use this content folder. Your original files remain in place.</p>}
        </div>
      ) : ready && (
        <>
          {plan === "create" && <>
            <button
              type="button" className="btn btn-primary self-start"
              disabled={busy || !directory.trim()}
              onClick={() => void submit({ action: "create", directory, name: DEFAULT_REPO_NAME })}
            >
              {busy ? "Creating your private repo…" : "Create my private DevHub repo"}
            </button>
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
              Creates a private repo named <code>{DEFAULT_REPO_NAME}</code> in your GitHub account, copies your current notes, tasks and diagrams
              into <code className="break-all">{directory || "a new folder"}</code>, and pushes them. <code>origin</code> is your private repo and
              <code> upstream</code> is the public DevHub code. No passwords or tokens are committed.
            </p>
          </>}
          {plan === "link" && <>
            <p className="text-sm">There is already a DevHub checkout at <code className="break-all">{data?.directory}</code>.</p>
            <button
              type="button" className="btn btn-primary self-start" disabled={busy || !directory.trim()}
              onClick={() => void submit({ action: "link", directory })}
            >
              {busy ? "Linking your private repo…" : "Link my existing checkout"}
            </button>
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Uses the notes and tasks already in it. Its origin must be a private repo. Current local content is kept where it is.</p>
          </>}
          {plan === "clone" && data?.remote && <>
            <p className="text-sm">You already have <code>{data.remote.repository}</code> on GitHub.</p>
            <button
              type="button" className="btn btn-primary self-start" disabled={busy || !directory.trim()}
              onClick={() => void submit({ action: "clone", directory, repository: data.remote!.repository })}
            >
              {busy ? "Cloning your private repo…" : "Clone my private repo"}
            </button>
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
              Downloads it into <code className="break-all">{directory}</code> and uses its content. Current local content is kept where it is.
            </p>
          </>}
          {plan === "blocked" && (
            <p className="tone-panel tone-panel--warning p-3 text-sm" role="status">
              A folder already exists at <code className="break-all">{data?.directory}</code> and it isn&apos;t a DevHub checkout, so DevHub won&apos;t create a repo there.
              Choose another folder below, or move that one aside.
            </p>
          )}
          {(plan === "clone" || plan === "blocked") && data?.suggestion && (
            <button
              type="button" className="btn btn-ghost self-start" disabled={busy}
              onClick={() => void submit({ action: "create", directory: data.suggestion!.directory, name: data.suggestion!.name })}
            >
              Create a new private repo named {data.suggestion.name} instead
            </button>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer" style={{ color: "var(--text-muted)" }}>Use a different name or folder, or a repo I already have</summary>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Private repository setup">
                <button type="button" className={action === "create" ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={action === "create"} disabled={busy} onClick={() => setAction("create")}>Create private copy</button>
                <button type="button" className={action === "clone" ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={action === "clone"} disabled={busy} onClick={() => setAction("clone")}>Clone my private repo</button>
                <button type="button" className={action === "link" ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={action === "link"} disabled={busy} onClick={() => setAction("link")}>Link existing checkout</button>
              </div>
              {action === "create" && (
                <label className="flex flex-col gap-1 text-sm">
                  GitHub repository name
                  <input className="input w-full" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} autoComplete="off" />
                </label>
              )}
              {action === "clone" && (
                <label className="flex flex-col gap-1 text-sm">
                  Private GitHub repository
                  <input className="input w-full" value={repository} placeholder="your-account/devhub-private" disabled={busy} onChange={(event) => setRepository(event.target.value)} autoComplete="off" />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                {action === "link" ? "Existing DevHub folder" : "New local folder"}
                <input className="input w-full" value={directory} disabled={busy} onChange={(event) => setDirectory(event.target.value)} autoComplete="off" />
              </label>
              {action === "link" && isDesktop() && (
                <button type="button" className="btn btn-ghost self-start" disabled={busy} onClick={async () => {
                  const folder = await pickFolder("Choose your private DevHub checkout");
                  if (folder) setDirectory(folder);
                }}><FolderOpen size={12} /> Browse</button>
              )}
              <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
                {action === "create"
                  ? "Creates a private repo in your GitHub account, copies your current personal content and pushes it there. Existing files and credentials stay on this machine."
                  : action === "clone"
                    ? "Downloads your existing private DevHub repo and uses its content. Current local content is kept where it is."
                    : "Uses the notes and tasks already in this checkout. Its origin must be private. Current local content is kept where it is."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || !directory.trim() || (action === "create" && !name.trim()) || (action === "clone" && !repository.trim())} onClick={() => void submit({ action, directory, name, repository })}>
                  {busy ? "Setting up private repo…" : action === "create" ? "Create and connect" : action === "clone" ? "Clone and connect" : "Connect private repo"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy || checking} onClick={() => void mutate()}>
                  <RotateCcw size={12} /> Re-check
                </button>
              </div>
            </div>
          </details>
        </>
      )}
      {error && <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{error}</p>}
      {!linked && onLater && (
        <button type="button" className="btn btn-ghost self-start" disabled={busy} onClick={onLater}>Do this later</button>
      )}
    </section>
  );
}
