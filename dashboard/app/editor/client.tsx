"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { SelectionPanel } from "@/components/editor/SelectionPanel";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { EditorSelection } from "@/lib/editor/selection";
import styles from "./editor.module.css";

interface Status { version: string; availableVersion: string; canRollback: boolean; installed: boolean; supported: boolean; installing: boolean; session: { ready: boolean; workspaceId: string; origin: string; error?: string } | null }
export default function EditorClient() {
  const params = useSearchParams();
  const router = useRouter();
  const [selectedWorkspace, setWorkspace] = useState(params.get("workspace") || "");
  const [selection, setSelection] = useState<EditorSelection>();
  const [pair, setPair] = useState<{ code: string; expiresAt: number }>();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  const confirm = useConfirm();
  const { data: repos, error: reposError } = useLive<{ repos: { name: string }[] }>("/api/repos");
  const { data, error, mutate } = useLive<Status>("/api/editor/runtime", { refreshInterval: 10000 });
  const workspace = data?.session?.workspaceId || selectedWorkspace;
  const incoming = params.get("selection");
  const [previewId, setPreviewId] = useState(incoming || "");
  const { error: inboxError } = useLive<{ pending: { id: string; selection: EditorSelection } | null }>(!incoming && data?.session?.ready ? "/api/editor/incoming?workspace=" + encodeURIComponent(workspace) : null, {
    refreshInterval: 1500, dedupingInterval: 1000,
    onSuccess: (inbox) => {
      if (!selection && inbox.pending && inbox.pending.id !== previewId) {
        setSelection(inbox.pending.selection); setPreviewId(inbox.pending.id);
      }
    },
  });
  useEffect(() => {
    if (!incoming) return;
    let disposed = false;
    void fetch("/api/editor/incoming?id=" + encodeURIComponent(incoming)).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!disposed) { setSelection(result.selection); setPreviewId(incoming); setWorkspace(result.selection.workspaceId); }
    }).catch((cause: unknown) => { if (!disposed) setFailure(cause instanceof Error ? cause.message : "Selection unavailable."); });
    return () => { disposed = true; };
  }, [incoming]);
  async function act(action: string) {
    if (pending) return;
    if (["stop", "uninstall"].includes(action) && !await confirm({ title: action === "stop" ? "Stop the editor?" : "Remove the editor runtime?", message: "Save all open buffers first. Workspace files and editor recovery data are kept.", confirmLabel: "Saved — continue" })) return;
    setPending(action); setFailure(""); setMessage("");
    try {
      const pairing = action === "pair" || action === "revoke";
      const response = await fetch(pairing ? "/api/editor/pair" : "/api/editor/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pairing ? { workspaceId: workspace, revoke: action === "revoke" } : { action, workspaceId: workspace || undefined, savedBuffers: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Editor action failed.");
      if (action === "pair") setPair(result);
      if (action === "revoke") { setPair(undefined); setMessage("Pairing revoked. Pending selections from this workspace were removed."); }
      if (result.password) setPassword(result.password);
      if (action === "stop") setPassword("");
      await mutate();
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Editor action failed."); }
    finally { setPending(""); }
  }
  const busy = Boolean(pending);
  const session = data?.session;
  const local = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  // Match the dashboard site so the editor’s SameSite login cookie works in its iframe.
  const editorOrigin = session && local ? session.origin.replace("127.0.0.1", window.location.hostname) : session?.origin;
  return <div className={"page-wrapper " + styles.page}>
    <header><h1>Editor</h1><p>Review code in DevHub, or open an optional editor for the same workspace.</p></header>
    {selection && <SelectionPanel selection={selection} close={() => {
      setSelection(undefined);
      if (incoming) {
        const url = new URL(window.location.href);
        url.searchParams.delete("selection");
        router.replace(url.pathname + url.search, { scroll: false });
      }
      if (previewId) void fetch("/api/editor/incoming", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: previewId }) }).catch(() => setFailure("Could not clear this selection. It will expire automatically."));
    }} />}
    {(error || reposError || inboxError) && <FetchError message={error?.message || reposError?.message || inboxError?.message || "Could not load editor"} onRetry={() => void mutate()} />}
    {failure && <p role="alert" className="tone-panel tone-panel--warning">{failure}</p>}
    {message && <p role="status" className="tone-panel tone-panel--muted">{message}</p>}
    <div className={styles.setup}>
      <section><h2>Workspace</h2><label>Repository<select className="input" value={workspace} disabled={busy || Boolean(session)} onChange={(event) => { setWorkspace(event.target.value); setPair(undefined); }}><option value="">Choose a repository</option>{repos?.repos.map((repo) => <option key={repo.name} value={repo.name}>{repo.name}</option>)}</select></label>
        <p>For a quick explanation, select lines in <Link href="/repos">Repos → Changes</Link> and choose Send to AI.</p>
      </section>
      <section><h2>Cursor and VS Code</h2><p>Install the DevHub Selection add-on, then pair this workspace. Unsaved selections go through the same preview and conversation choices.</p>
        <div className={styles.actions}><button className="btn btn-ghost" disabled={!workspace || busy} onClick={() => void act("pair")}>{pending === "pair" ? "Creating code…" : "Create pairing code"}</button><button className="btn btn-ghost" disabled={!workspace || busy} onClick={() => void act("revoke")}>Revoke pairing</button></div>
        {pair && <div className="tone-panel tone-panel--muted"><p>Run <strong>DevHub: Pair this Workspace</strong> in your editor and paste the code. Expires {new Date(pair.expiresAt).toLocaleTimeString()}.</p><button className="btn btn-ghost" onClick={() => void copyTextToClipboard(pair.code).then(() => setMessage("Pairing code copied.")).catch(() => setFailure("Clipboard unavailable."))}>Copy pairing code</button></div>}
        <Link href="/docs/guides/editor">Add-on setup and platform notes</Link>
      </section>
      <section><h2>Optional in-app editor</h2>{!data ? <SkeletonRows count={2} /> : <>
        <p>code-server {data.version} · separate settings and extensions. Installing downloads about 240 MB. Opening a workspace gives the editor filesystem access under your account.</p>
        {!data.supported && <p className="tone-panel tone-panel--warning">Run the service inside WSL on Windows. Native Windows editor hosting is not enabled.</p>}
        <div className={styles.actions}>{!data.installed ? <button className="btn btn-primary" disabled={busy || !data.supported} onClick={() => void act("install")}>{pending === "install" && <Loader2 size={14} className="animate-spin" />}{pending === "install" ? "Installing…" : "Install optional editor"}</button> : <>
          <button className="btn btn-primary" disabled={busy || !workspace || !local} onClick={() => void act("start")}>{pending === "start" ? "Opening…" : session ? "Show login password" : "Open editor"}</button>
          {session ? <button className="btn btn-ghost" disabled={busy} onClick={() => void act("stop")}>{pending === "stop" ? "Stopping…" : "Stop editor"}</button> : <button className="btn btn-ghost" disabled={busy} onClick={() => void act("uninstall")}>Remove runtime</button>}
        </>}{data.installed && !session && data.availableVersion !== data.version && <button className="btn btn-ghost" disabled={busy} onClick={() => void act("install")}>Update to {data.availableVersion}</button>}{data.canRollback && !session && <button className="btn btn-ghost" disabled={busy} onClick={() => void act("rollback")}>Use previous version</button>}</div>
        {!local && <p>Open DevHub on this computer to use the editor.</p>}
        {session?.error && <p role="alert" className="tone-panel tone-panel--warning">{session.error}</p>}
        {password && <p className={styles.login}>The editor has its own login. <button className="btn btn-ghost" onClick={() => void copyTextToClipboard(password).then(() => setMessage("Editor password copied. Paste it into the editor login.")).catch(() => setFailure("Clipboard unavailable."))}>Copy editor password</button></p>}
      </>}</section>
    </div>
    {session?.ready && !session.error && local && <iframe title="DevHub code editor" src={editorOrigin} className={styles.frame} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox" allow="clipboard-read; clipboard-write" />}
  </div>;
}
