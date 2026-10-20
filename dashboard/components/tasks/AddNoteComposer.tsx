"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { AddUserNoteResult, NoteCapability } from "@/lib/tasks/add-user-note";
import styles from "./AddNoteComposer.module.css";

const OPEN_NOTE = "devhub:add-task-note";
export function requestTaskNote(taskId: string) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_NOTE, { detail: taskId })), 0);
}

export interface AddNoteComposerProps {
  taskId: string;
  title: string;
  id?: string;
  profile?: string;
  capability?: NoteCapability;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onSaved: (result: AddUserNoteResult) => void;
}

export function AddNoteComposer({ taskId, title, id, profile, capability, triggerRef, onCancel, onSaved }: AddNoteComposerProps) {
  const generatedId = useId();
  const composerId = id ?? generatedId;
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string>();
  const [state, setState] = useState(capability);
  // The composer only mounts after a click, so reading the platform at first render is safe.
  const [shortcut] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Enter" : "Ctrl+Enter");
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  const suffix = profile ? "?profile=" + encodeURIComponent(profile) : "";
  useEffect(() => {
    area.current?.focus();
    const controller = new AbortController();
    fetch("/api/tasks/note/add?taskId=" + encodeURIComponent(taskId) + (profile ? "&profile=" + encodeURIComponent(profile) : ""), { signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Couldn't check the running agent."); setState(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn't check the running agent."); });
    return () => controller.abort();
  }, [taskId, profile]);
  const save = async (updateAgent = false) => {
    if (saving.current || !text.trim()) return;
    if (updateAgent && !state?.liveFollowup && state?.confirmNeeded && !window.confirm("Stop the run and update? Uncommitted work may be discarded.")) return;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/tasks/note/add" + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, text, updateAgent, ...(savedId ? { noteId: savedId } : {}), ...(updateAgent && state?.confirmNeeded ? { confirmStop: true } : {}) }) });
      const result: AddUserNoteResult & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't save the note.");
      if (result.agent.error) { setSavedId(result.note.id); setState(result.capability); setError(result.agent.error); return; }
      if (form.current?.contains(document.activeElement)) triggerRef?.current?.focus();
      onSaved(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't save the note."); }
    finally { saving.current = false; setPending(false); }
  };
  return <form ref={form} id={composerId} className="mt-2 flex min-w-0 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }} onKeyDown={(event) => {
    if (event.key === "Escape" && !pending) { event.preventDefault(); event.stopPropagation(); onCancel(); triggerRef?.current?.focus(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); void save(); }
  }}>
    <label className="sr-only" htmlFor={composerId + "-text"}>Note for {title}</label>
    <textarea ref={area} id={composerId + "-text"} className="input w-full resize-y" rows={2} placeholder="Add context or guidance…" maxLength={4000} value={text} disabled={pending} onChange={(event) => { setText(event.target.value); setSavedId(undefined); }} />
    <p className="text-xs text-text-muted">{state?.running ? "Save note applies next stage · " : ""}{shortcut} saves · Esc cancels</p>
    <div className={"flex flex-wrap items-center justify-end gap-2 " + styles.actions}>
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { onCancel(); triggerRef?.current?.focus(); }}>Cancel</button>
      <button type="submit" className={"btn " + (state?.running ? "btn-ghost" : "btn-primary")} disabled={pending || !text.trim()}>{state?.running ? "Save note" : "Save"}</button>
      {state?.running ? <button type="button" className="btn btn-primary" disabled={pending || !text.trim()} onClick={() => void save(true)}>{state.liveFollowup ? "Send to agent" : "Save and update agent"}</button> : null}
    </div>
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </form>;
}

export function useTaskNoteComposer({ taskId, title, profile, running = false }: { taskId: string; title: string; profile?: string; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === taskId) { setConfirmation(""); setOpen(true); } };
    window.addEventListener(OPEN_NOTE, listener);
    return () => window.removeEventListener(OPEN_NOTE, listener);
  }, [taskId]);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(""), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);
  return {
    triggerRef,
    trigger: <button ref={triggerRef} type="button" className={"text-xs text-text-muted hover:text-text underline-offset-4 hover:underline " + styles.trigger} aria-expanded={open} aria-controls={id} onClick={() => { setConfirmation(""); setOpen(true); }}>Add note</button>,
    composer: open || confirmation ? <div data-task-note-content className="w-full basis-full">{open ? <AddNoteComposer taskId={taskId} title={title} profile={profile} id={id} triggerRef={triggerRef} capability={{ running, auto: false, liveFollowup: false, confirmNeeded: false }} onCancel={() => setOpen(false)} onSaved={(result) => {
      setOpen(false);
      const updated = result.agent.mode === "followup" ? " · Sent to agent" : result.agent.mode !== "none" ? " · Agent updated" : "";
      setConfirmation("Note saved" + updated + " · " + result.note.text);
    }} /> : <p role="status" aria-live="polite" className="mt-2 line-clamp-2 text-xs text-text-muted">{confirmation}</p>}</div> : null,
  };
}
