"use client";

import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FolderOpen, RotateCcw } from "lucide-react";
import { pickFolder, isDesktop } from "@/lib/desktop/bridge";

interface RepoStatus { directory: string; linked: boolean; url?: string; error?: string; existing?: boolean }

export function PrivateRepoSetup({ connected, onLinked }: { connected: boolean; onLinked: () => void }) {
  const { data, error: fetchError, isLoading: checking, mutate } = useLive<RepoStatus>(
    connected ? "/api/setup/private-repo" : null, { refreshInterval: 0 },
  );
  const [chosenAction, setAction] = useState<"create" | "clone" | "link" | null>(null);
  const action = chosenAction ?? (data?.existing ? "link" : "create");
  const [name, setName] = useState("devhub-private");
  const [repository, setRepository] = useState("");
  const [chosenDirectory, setDirectory] = useState<string | null>(null);
  const directory = chosenDirectory ?? data?.directory ?? "";
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const error = actionError || fetchError?.message || data?.error || "";
  const [connectedRepo, setLinked] = useState<RepoStatus | null>(null);
  const linked = connectedRepo ?? (data?.linked ? data : null);
  const [restartRequired, setRestartRequired] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/private-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, directory, ...(action === "create" ? { name } : action === "clone" ? { repository } : {}) }),
      });
      const data: RepoStatus = await response.json();
      if (!response.ok) throw new Error(data.error || "Private repository setup failed.");
      setLinked({ ...data, linked: true });
      setRestartRequired(true);
      onLinked();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-6 flex flex-col gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-base font-semibold">Your private DevHub repo</h3>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Keep notes, tasks and diagrams in your own private GitHub repo. DevHub creates an independent
        copy of the public code; a GitHub fork of a public repo would stay public. App updates still
        come from DevHub releases.
      </p>
      {!connected ? (
        <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Sign in above to connect your private repo. GitHub CLI comes with DevHub; if Git is missing, install it in Tools. You can also finish setup locally and connect later.</p>
      ) : checking ? <SkeletonRows count={3} height={40} /> : linked ? (
        <div className="tone-panel tone-panel--accent p-3 text-sm">
          <p>Private repo linked: <a className="text-accent" href={linked.url} target="_blank" rel="noopener noreferrer">{linked.url}</a></p>
          <p className="mt-1 font-mono text-xs break-all">{linked.directory}</p>
          {restartRequired && <p className="mt-2">Quit and reopen DevHub to use this content folder. Your original files remain in place.</p>}
        </div>
      ) : (
        <>
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
            <button type="button" className="btn btn-primary" disabled={busy || checking || !directory.trim() || (action === "create" && !name.trim()) || (action === "clone" && !repository.trim())} onClick={() => void submit()}>
              {busy ? "Setting up private repo…" : action === "create" ? "Create and connect" : action === "clone" ? "Clone and connect" : "Connect private repo"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy || checking} onClick={() => void mutate()}>
              <RotateCcw size={12} /> Re-check
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{error}</p>}
    </section>
  );
}
