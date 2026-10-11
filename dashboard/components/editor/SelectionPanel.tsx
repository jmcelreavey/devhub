"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Loader2 } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { PersistentAgents } from "@/components/persistent/PersistentAgents";
import type { EditorSelection } from "@/lib/editor/selection";
import styles from "./SelectionPanel.module.css";

interface RunChoice { id: string; title: string; provider: string; taskId?: string; busy: boolean; resumable: boolean }
interface Choices { runs: RunChoice[]; tasks: { id: string; text: string }[] }
interface Provider { id: string; name: string; ready: boolean }
interface StartedRun { id: string; conversationId?: string; state: string; error?: string }
export function SelectionPanel({ selection, close }: { selection: EditorSelection; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const sending = useRef(false);
  const [choices, setChoices] = useState<Choices>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("");
  const [runId, setRunId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [question, setQuestion] = useState("Explain this selection and flag any risks.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<StartedRun>();
  const [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [preview, connection] = await Promise.all([
          fetch("/api/editor/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection }) }),
          fetch("/api/agent/connection"),
        ]);
        const [data, agents] = await Promise.all([preview.json(), connection.json()]);
        if (!preview.ok) throw new Error(data.error || "Could not preview this selection.");
        if (!connection.ok || !agents.connected) throw new Error(agents.error || "Paseo is unavailable. Start it in Agents → Connection, then retry.");
        if (cancelled) return;
        setChoices(data); setProviders(agents.agents); setProvider(agents.defaultAgentId || agents.agents.find((item: Provider) => item.ready)?.id || ""); setError("");
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load selection choices."); }
    }
    void load();
    return () => { cancelled = true; };
  }, [selection, retry]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current || run) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/editor/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection, send: { requestId: requestId.current, question, provider, runId: runId || undefined, taskId: taskId || undefined } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send. Retry uses the same request, so it cannot start a duplicate.");
      setRun(data.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send this selection."); }
    finally { sending.current = false; setBusy(false); }
  }
  const existing = choices?.runs.find((item) => item.id === runId);
  return <dialog ref={dialog} className={styles.panel} aria-label="Ask AI about selection" onCancel={close}>
    <header className={styles.header}><div><h2>Ask AI</h2><p>{selection.relativePath} · {selection.ranges}</p></div><button className="btn btn-ghost" onClick={close} aria-label="Close selection"><X size={18} /></button></header>
    {run ? <>{run.error && <p role="alert" className="tone-panel tone-panel--warning">{run.error}</p>}<p className={styles.notice}>This conversation remains in Agents after you close this panel.</p><div className={styles.chat}><PersistentAgents sideRun={run} /></div></> :
    <form onSubmit={submit} className={styles.body}>
      <p className="text-sm text-text-muted">Discuss the captured code beside your diff. No extra worktree is created.</p>
      <details open><summary>Selection preview · {selection.source}{selection.dirty ? selection.source === "editor" ? " · unsaved buffer" : " · uncommitted snapshot" : ""}</summary><pre className={styles.code}>{selection.selectedText}</pre><p className={styles.revision}>Revision {selection.revision}{selection.documentVersion === undefined ? "" : " · document " + selection.documentVersion}</p></details>
      {!choices && !error && <SkeletonRows count={3} />}
      {choices && <>
        <label>Conversation<select className="input" value={runId} disabled={busy} onChange={(event) => { setRunId(event.target.value); const item = choices.runs.find((candidate) => candidate.id === event.target.value); setTaskId(item?.taskId || ""); }}>
          <option value="">New explanation conversation</option>{choices.runs.map((item) => <option key={item.id} value={item.id} disabled={item.busy || !item.resumable}>{item.title} · {item.provider}{item.busy ? " — busy" : !item.resumable ? " — unavailable" : ""}</option>)}
        </select></label>
        <label>Linked task<select className="input" value={taskId} disabled={busy || Boolean(runId)} onChange={(event) => setTaskId(event.target.value)}><option value="">No task</option>{choices.tasks.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>
        {!existing && <label>Send to<select className="input" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value)}>{providers.map((item) => <option key={item.id} value={item.id} disabled={!item.ready}>{item.name}{item.ready ? "" : " — unavailable"}</option>)}</select></label>}
        <label>Your question<textarea className="input" rows={4} required maxLength={8000} value={question} disabled={busy} onChange={(event) => setQuestion(event.target.value)} /></label>
        <p className="text-xs text-text-muted">The preview and your question go to {existing?.provider || providers.find((item) => item.id === provider)?.name || "the selected provider"}. The explanation request does not restrict the assistant’s local permissions.</p>
      </>}
      {error && <div role="alert" className="tone-panel tone-panel--warning">{error}{!choices && <button type="button" className="btn btn-ghost" onClick={() => setRetry((value) => value + 1)}>Retry connection</button>}</div>}
      <footer className={styles.actions}><button type="button" className="btn btn-ghost" onClick={close}>{busy ? "Close panel" : "Cancel"}</button><button className="btn btn-primary" disabled={busy || !choices || !provider || !question.trim()}>{busy && <Loader2 size={14} className="animate-spin" />}{busy ? "Sending…" : "Send selection"}</button></footer>
    </form>}
  </dialog>;
}
