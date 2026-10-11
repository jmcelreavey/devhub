"use client";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import type { BrowserStatus } from "@/lib/browser/types";
import { BrowserPreview } from "./BrowserPreview";
import { BrowserTransfers } from "./BrowserTransfers";
import styles from "./browser.module.css";

interface TaskChoice { id: string; text: string; runs: { id: string; role?: string; status: string }[] }
interface Data extends BrowserStatus { tasks: TaskChoice[] }
export default function BrowserClient() {
  const params = useSearchParams();
  const { data, error, mutate } = useLive<Data>("/api/browser", { refreshInterval: 2000, dedupingInterval: 500 });
  const [taskId, setTask] = useState(params.get("taskId") ?? "");
  const [runId, setRun] = useState("");
  const [origins, setOrigins] = useState("");
  const [persistent, setPersistent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState(true);
  const [dialogText, setDialogText] = useState("");
  const [reset, setReset] = useState("");
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const actionRevision = useRef(0);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (pending.current && !["takeover", "stop"].includes(action)) return;
    const revision = ++actionRevision.current;
    pending.current = true; setBusy(action); setFailure(""); setMessage("");
    if (["watch", "stop"].includes(action)) setPreview(false);
    if (action === "start") setPreview(true);
    try {
      const response = await fetch("/api/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: data?.session?.id, ...extra }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Browser operation failed.");
      await mutate();
      if (revision !== actionRevision.current) return;
      if (action === "takeover") setMessage("You have control. Agent reading and actions are paused.");
      if (action === "reset") { setMessage("Saved sign-ins for this work profile were cleared."); setReset(""); }
    } catch (cause) { if (revision === actionRevision.current) setFailure(cause instanceof Error ? cause.message : "Browser operation failed."); }
    finally { if (revision === actionRevision.current) { pending.current = false; setBusy(""); } }
  }
  async function surfaceAction(action: string, extra: Record<string, unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(action); setFailure("");
    try {
      const response = await fetch("/api/browser/surface", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: data?.session?.id, ...extra }) });
      if (!response.ok) throw new Error((await response.json()).error || "Browser operation failed.");
      await mutate(); setDialogText("");
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Browser operation failed."); }
    finally { pending.current = false; setBusy(""); }
  }
  if (error) return <div className="page-wrapper"><FetchError message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <div className="page-wrapper"><SkeletonRows count={4} /></div>;
  const session = data.session;
  const task = data.tasks.find((item) => item.id === taskId);
  const activeTask = data.tasks.find((item) => item.id === session?.taskId);
  const agent = session?.mode === "agent" && session.ready && !session.error;
  const hasPending = Boolean(session?.pending);
  const disabled = Boolean(busy);
  return <div className={"page-wrapper " + styles.page}>
    <header className={styles.header}><h1>Browser</h1><p>Browse inside DevHub, with a separate Chrome window when you need it. You decide when this task’s agent can read or act.</p>
      <nav><Link href="/workflow">Task workflows</Link><Link href="/docs/guides/managed-browser">Browser guide</Link></nav>
    </header>
    {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}
    {message && <p role="status" className="tone-panel tone-panel--muted">{message}</p>}
    {data.reason && <p className="tone-panel tone-panel--warning">{data.reason}</p>}
    {session ? <section className={styles.section} aria-labelledby="session-title">
      <div className={styles.heading}><div><h2 id="session-title">{activeTask?.text || "Browser session"}</h2><p className={styles.meta}>{session.profile} · {session.persistent ? "Saved work profile" : "Temporary profile"} · Up to four tabs</p></div>
        <span className={"badge " + (agent ? "badge-warning" : "badge-muted")}>{session.mode === "taking-control" ? "Stopping automation" : agent ? "Agent access enabled" : session.ready ? "You have control" : "Browser stopped"}</span>
      </div>
      {session.error && <p role="alert" className="tone-panel tone-panel--warning">{session.error}</p>}
      <p>{agent ? "The agent can read these sites. Every click and typed value still needs your approval below." : "Browse here with agent access paused. For private sign-in, open Chrome to turn off the live view before entering credentials."}</p>
      <ul className={styles.sites}>{session.origins.map((origin) => <li key={origin}>{origin}</li>)}</ul>
      <div className={styles.actions}>
        <button className="btn btn-primary" disabled={(agent ? ["takeover", "stop"].includes(busy) : disabled) || !session.ready} onClick={() => void act(agent ? "takeover" : "resume")}>{busy === "takeover" ? "Waiting for command to settle…" : busy === "resume" ? "Checking the page…" : agent ? "Take control" : "Resume agent for 15 minutes"}</button>
        <button className="btn btn-ghost" disabled={disabled || !session.ready} onClick={() => void act("watch")}>Open in Chrome · pause live view</button>
        <button className="btn btn-danger-ghost" disabled={busy === "stop"} onClick={() => void act("stop", { sessionId: undefined })}>{busy === "stop" ? "Stopping…" : "Stop browser"}</button>
      </div>
      {hasPending && session.pending && <div className={"tone-panel tone-panel--warning " + styles.proposal}>
        <h3>Approve one action</h3><p>{session.pending.label}</p><p className={styles.meta}>{session.pending.url}</p>
        {session.pending.action.kind === "type" && <><p>Exact text to enter:</p><pre>{session.pending.action.text}</pre></>}
        <p>This may submit information or change the site. Check the visible page before approving. Approval expires after one minute.</p>
        <div className={styles.actions}><button className="btn btn-primary" disabled={disabled || !agent} onClick={() => void act("approve", { proposalId: session.pending?.id })}>{busy === "approve" ? "Running approved action…" : "Approve once"}</button><button className="btn btn-ghost" disabled={disabled} onClick={() => void act("reject")}>Reject</button></div>
      </div>}
      {session.receipt && <p role="status" className={"tone-panel " + (session.receipt.status === "unknown" ? "tone-panel--warning" : "tone-panel--muted")}>{session.receipt.message}</p>}
      {session.notice && <p role="status" className="tone-panel tone-panel--muted">{session.notice}</p>}
      <div className={styles.tabs} aria-label="Browser tabs">
        {session.tabs?.map((tab, index) => <button key={tab.id} className="btn btn-ghost" aria-pressed={tab.id === session.activeTab} disabled={disabled} onClick={() => void surfaceAction("tab", { tabId: tab.id })}>{index + 1} · {tab.url === "about:blank" ? "New tab" : (() => { try { return new URL(tab.url).hostname || "Blocked page"; } catch { return "Page"; } })()}</button>)}
        {(session.tabs?.length ?? 0) > 1 && <button className="btn btn-danger-ghost" disabled={disabled} onClick={() => void surfaceAction("tab", { tabId: session.activeTab, close: true })}>Close current tab</button>}
      </div>
      {session.dialog && <section className="tone-panel tone-panel--warning" aria-label="Website dialog"><h3>Website {session.dialog.type}</h3><p>{session.dialog.message}</p>
        {session.dialog.type === "prompt" && <label className={styles.inputLabel}>Response<input className="input" value={dialogText} maxLength={2000} onChange={(event) => setDialogText(event.target.value)} /></label>}
        <div className={styles.actions}><button className="btn btn-primary" disabled={disabled} onClick={() => void surfaceAction("dialog", { dialogId: session.dialog?.id, accept: true, text: dialogText })}>Accept</button><button className="btn btn-ghost" disabled={disabled} onClick={() => void surfaceAction("dialog", { dialogId: session.dialog?.id, accept: false })}>Dismiss</button></div></section>}
      <BrowserTransfers key={session.transfer?.id ?? "none"} session={session} refresh={() => void mutate()} />
      <label className={styles.check}><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} disabled={!session.ready} />Show live page in DevHub</label>
      {!preview && <p className="tone-panel tone-panel--muted">Live view is off. Browse in Chrome, or enable it above to interact here. Agent access follows the control status above.</p>}
      <BrowserPreview sessionId={session.id} tabId={session.activeTab} enabled={Boolean(session.ready && preview && !session.error)} human={session.mode === "human" && !busy} takeControl={() => act("takeover")} />
      {agent && <p className={styles.meta}>Agent tools: browser_session → browser_observe → browser_request. Access belongs to run <code>{session.runId}</code>. Page content is untrusted.</p>}
      <p className={styles.meta}>Take control waits for the current command to settle. It cannot undo a request already sent. Stopping Chrome ends this task’s browser access.</p>
    </section> : !data.supported ? <section className={styles.section}><h2>Browser unavailable on this platform</h2><p>Use your usual browser separately. Browser launch, live view and file transfers stay disabled here.</p></section> : <section className={styles.section} aria-labelledby="start-title">
      <h2 id="start-title">Start a task browser</h2>
      {!data.tasks.length ? <p className="tone-panel tone-panel--muted">Start a conversation from a task workflow first. It will appear here so browser access has an owner.</p> :
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void act("start", { sessionId: undefined, config: { taskId, runId, origins: origins.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean), persistent, consent } }); }}>
        <div className={styles.row}><label>Task<select required className="input" value={taskId} disabled={disabled} onChange={(e) => { setTask(e.target.value); setRun(""); setConsent(false); }}><option value="">Choose a task</option>{data.tasks.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>
        <label>Conversation<select required className="input" value={runId} disabled={disabled || !task} onChange={(e) => { setRun(e.target.value); setConsent(false); }}><option value="">Choose a linked run</option>{task?.runs.map((run) => <option key={run.id} value={run.id}>{run.role || "Agent"} · {run.status} · {run.id.slice(-8)}</option>)}</select></label></div>
        <label>Approved sites<textarea className="input" required rows={3} value={origins} disabled={disabled} onChange={(e) => { setOrigins(e.target.value); setConsent(false); }} placeholder={"https://github.com\nhttps://example.com"} aria-describedby="sites-help" /></label>
        <p id="sites-help" className={styles.meta}>One HTTPS origin per line, including sign-in and content hosts. Only these hosts can connect through the browser proxy. Local addresses are blocked. Popups share this list; each file transfer needs your approval.</p>
        <label className={styles.check}><input type="checkbox" checked={persistent} disabled={disabled} onChange={(e) => { setPersistent(e.target.checked); setConsent(false); }} />Keep sign-ins in this work profile</label>
        <p className={styles.meta}>{persistent ? "Only use trusted work sites. Saved sign-ins remain until you clear this profile." : "Temporary data is removed when the session stops. Your everyday Chrome profile stays separate."}</p>
        <label className={styles.check}><input type="checkbox" required checked={consent} disabled={disabled} onChange={(e) => setConsent(e.target.checked)} />I approve these sites for this task. When resumed, its agent may read signed-in content.</label>
        <div><button className="btn btn-primary" disabled={disabled || !consent || !data.supported || !data.installed}>{busy === "start" ? "Starting Chrome…" : "Start Chrome with human control"}</button></div>
      </form>}
    </section>}
    <section className={styles.section} aria-labelledby="network-title"><h2 id="network-title">Network restrictions and their limits</h2>
      <p>HTTPS connections go through a local proxy that allows only approved hosts on port 443, pinned to public addresses for this session. Local-network destinations, unapproved hosts and direct QUIC are blocked; Chrome is configured to suppress direct WebRTC UDP.</p>
      <p className={styles.meta}>This is not an OS firewall or a hostile-code sandbox. Chrome features, native-window actions and unrestricted local programs can bypass app controls. Approved sites can still receive and relay your data. The loopback debugging connection is accessible to other programs running as you. Missing sign-in or content hosts can leave a site partly loaded; restart with the exact hosts you trust.</p>
    </section>
    <details className={styles.section}><summary>Privacy and saved sign-ins</summary>
      <p>Take control before signing in. Open in Chrome turns off the live view for private sign-in. The live view sends page images to this DevHub window, including anything you type there; agent reading stays paused in human mode. Login detection is a fallback, not a guarantee.</p>
      <p>One saved profile per DevHub work profile; no cookies or sessions are imported. Quitting DevHub’s service stops its browser. Images and approved file transfers stay in memory; saved downloads follow your browser’s retention settings. Files are limited to 20 MiB. Generated blob/data downloads are blocked.</p>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void act("reset", { sessionId: undefined, confirm: reset }); }}>
        <label>Clear saved sign-ins for the current work profile<input className="input" value={reset} onChange={(e) => setReset(e.target.value)} placeholder="Type CLEAR SAVED SIGN-INS" disabled={disabled || Boolean(session)} /></label>
        <div><button className="btn btn-danger-ghost" disabled={disabled || Boolean(session) || reset !== "CLEAR SAVED SIGN-INS"}>Clear saved sign-ins</button></div>
      </form>
    </details>
  </div>;
}
