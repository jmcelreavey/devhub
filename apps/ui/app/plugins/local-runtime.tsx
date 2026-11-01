"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { CopyButton } from "@/components/ui/CopyButton";
import type { PluginPreview } from "../../../../packages/shared/ui-lib/plugins/model";
import { asFailure, postJson } from "./api";

interface LocalReview {
  preview: PluginPreview;
  message: string | null;
}

function Fingerprint({ value }: { value: string }) {
  return <div className="flex flex-wrap items-center gap-2 text-xs"><span>Fingerprint</span><code title={value}>{value.slice(0, 16)}…</code><CopyButton text={value} label="fingerprint" /></div>;
}

function ReviewPlan({ preview }: { preview: PluginPreview }) {
  return (
    <div className="space-y-3 text-sm">
      <p>Review {preview.plugin?.name} {preview.plugin?.version}. Nothing has been enabled.</p>
      <Fingerprint value={preview.planDigest} />
      {preview.replacement ? <div className="tone-panel tone-panel--warning text-xs">
        <p>Replaces {preview.replacement.managed ? "the managed snapshot" : "the local registration"}; keeps its ID and {preview.replacement.enabled ? "enabled" : "disabled"} state.</p>
        <p className="mt-1 break-all">Previous source: {preview.replacement.path}</p>
        <p className="mt-1">Version: {preview.replacement.previousVersion} → {preview.plugin?.version}</p>
        <p className="mt-1 break-all">Previous tree SHA-256: {preview.replacement.previousTreeHash ?? "No approved snapshot"}</p>
        <p className="mt-1 break-all">Candidate tree SHA-256: {preview.replacement.nextTreeHash}</p>
        {preview.replacement.changes.map((change) => <p className="mt-1 break-words" key={change}>{change}</p>)}
      </div> : null}
      {preview.inventory.map((group) => <div key={group.kind}>
        <p className="font-semibold">{group.kind}</p>
        {group.entries.map((entry) => <p className="break-words text-xs text-text-subtle" key={entry}>{entry}</p>)}
        {group.note ? <p className="text-xs text-text-subtle">{group.note}</p> : null}
        {group.more ? <p className="text-xs text-text-subtle">{group.more} more entries</p> : null}
      </div>)}
      <p className="text-xs text-text-subtle">Skills and agents aren’t published by this action.</p>
    </div>
  );
}

function RuntimeDialog({ initialPath, initialReview, initialConfirm = false, open, onClose, onTrusted }: {
  initialPath: string;
  initialReview: LocalReview | null;
  initialConfirm?: boolean;
  open: boolean;
  onClose: () => void;
  onTrusted: () => void;
}) {
  const [folder, setFolder] = useState(initialPath);
  const [review, setReview] = useState(initialReview);
  const [confirming, setConfirming] = useState(initialConfirm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function plan() {
    if (busy || !folder.trim()) return;
    setBusy(true);
    setError(null);
    try { setReview(await postJson<LocalReview>("/api/plugins/local-runtime", { path: folder })); }
    catch (err) { setError(asFailure(err).message); }
    finally { setBusy(false); }
  }

  async function trust() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      await postJson<LocalReview>("/api/plugins/local-runtime", { path: folder, fingerprint: review.preview.planDigest });
      onTrusted();
      onClose();
    } catch (err) {
      setError(asFailure(err).message);
      setConfirming(false);
      setReview(null);
    } finally { setBusy(false); }
  }

  return <ModalShell open={open} onClose={() => { if (!busy) onClose(); }} dismissOnBackdrop={!busy} dismissOnEscape={!busy} title={confirming ? `Trust ${review?.preview.plugin?.name ?? "plugin"}?` : review ? "Review local plugin" : "Add local plugin"} maxWidth="max-w-xl" footer={
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn btn-ghost text-xs" disabled={busy} onClick={confirming ? () => setConfirming(false) : onClose}>{confirming ? "Back" : "Cancel"}</button>
      {confirming ? <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => void trust()}>{busy ? "Trusting…" : review?.preview.replacement?.enabled === false ? "Trust (keep disabled)" : "Trust and enable"}</button>
        : review ? <button type="button" className="btn btn-primary text-xs" onClick={() => setConfirming(true)}>Trust</button>
        : <button type="button" className="btn btn-primary text-xs" disabled={busy || !folder.trim()} onClick={() => void plan()}>{busy ? "Reviewing…" : "Review"}</button>}
    </div>
  }>
    <div className="plugin-content">
      {error ? <p className="tone-panel tone-panel--danger mb-4 text-sm" role="alert">{error}</p> : null}
      {confirming && review ? <div className="space-y-3 text-sm">
        <p>Trusting this plugin lets DevHub run its code with your user account. Only trust code you have reviewed.</p>
        <p><strong>Plugin:</strong> {review.preview.plugin?.name}</p>
        <p className="break-all"><strong>Path:</strong> {folder}</p>
        <p className="break-all"><strong>Full fingerprint:</strong> <code>{review.preview.planDigest}</code></p>
        <details><summary className="cursor-pointer">Review plugin plan</summary><div className="mt-3"><ReviewPlan preview={review.preview} /></div></details>
      </div> : review ? <ReviewPlan preview={review.preview} /> : <form onSubmit={(event) => { event.preventDefault(); void plan(); }}>
        <label className="text-sm font-semibold" htmlFor="local-plugin-path">Local folder path</label>
        <input id="local-plugin-path" className="input mt-2 w-full" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/path/to/plugin" autoComplete="off" spellCheck={false} />
        <p className="mt-3 text-xs text-text-subtle">Enter an absolute path or a path beginning with ~/.</p>
      </form>}
    </div>
  </ModalShell>;
}

export function AddLocalRuntime({ onTrusted, disabled }: { onTrusted: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn btn-ghost text-xs" disabled={disabled} onClick={() => setOpen(true)}>Add local plugin</button>
    {open ? <RuntimeDialog initialPath="" initialReview={null} open onClose={() => setOpen(false)} onTrusted={onTrusted} /> : null}
  </>;
}

export function LocalRuntimeTrust({ path, onTrusted }: { path: string; onTrusted: () => void }) {
  const [review, setReview] = useState<LocalReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void postJson<LocalReview>("/api/plugins/local-runtime", { path }).then((result) => {
      if (active) { setReview(result); setError(null); }
    }).catch((err: unknown) => { if (active) setError(asFailure(err).message); });
    return () => { active = false; };
  }, [path, attempt]);
  return <div className="mt-2">
    {review ? <div className="flex flex-wrap items-center justify-between gap-2"><Fingerprint value={review.preview.planDigest} /><button type="button" className="btn btn-ghost text-xs" onClick={() => setOpen(true)}>Trust</button></div>
      : error ? <div className="text-xs text-warning" role="alert">{error} <button type="button" className="btn btn-ghost text-xs" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
      : <p className="text-xs text-text-subtle" role="status">Reviewing fingerprint…</p>}
    {open && review ? <RuntimeDialog initialPath={path} initialReview={review} initialConfirm open onClose={() => setOpen(false)} onTrusted={onTrusted} /> : null}
  </div>;
}
