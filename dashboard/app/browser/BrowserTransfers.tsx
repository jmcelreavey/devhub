"use client";
import { useRef, useState } from "react";
import type { BrowserSessionView } from "@/lib/browser/types";
import styles from "./browser.module.css";

export function BrowserTransfers({ session, refresh }: { session: BrowserSessionView; refresh: () => void }) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const transfer = session.transfer;
  if (!transfer) return null;
  const upload = transfer.kind === "upload";
  async function act(approve: boolean) {
    if (pending.current || !transfer) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = approve
        ? await fetch("/api/browser/transfer?session=" + session.id + "&transfer=" + transfer.id, { method: "POST", headers: file && upload ? { "x-file-name": encodeURIComponent(file.name) } : {}, body: upload ? file : undefined })
        : await fetch("/api/browser/surface", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject-transfer", sessionId: session.id, transferId: transfer.id }) });
      if (!response.ok) throw new Error((await response.json()).error || "Transfer failed. Request it from the site again.");
      if (approve && !upload) {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = url; link.download = transfer.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setFile(undefined); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transfer failed."); refresh(); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={"tone-panel tone-panel--warning " + styles.proposal} aria-label="File approval">
    <h3>{upload ? "Approve a file upload" : "Approve a download"}</h3>
    <p>{transfer.origin}</p>
    {upload ? <>
      <label className={styles.inputLabel}>Choose one file · up to 20 MiB<input type="file" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0]); setError(""); }} /></label>
      {file && <p>{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>}
      {file && file.size > 20 * 1024 * 1024 && <p role="alert">This file is larger than 20 MiB. Choose a smaller file to continue.</p>}
      <p>The page receives this file only after approval and may upload it immediately. No local path is shared.</p>
    </> : <><p><strong>{transfer.name}</strong> · {transfer.bytes ? (transfer.bytes / 1024).toFixed(1) + " KiB" : "Size unknown; limited to 20 MiB"}</p><p>The response is paused. Approve to read and save this file using your browser’s download controls. DevHub does not open it.</p></>}
    <p className={styles.meta}>Approval expires after one minute. Files are held in memory for transfer; no DevHub download archive is kept.</p>
    {error && <p role="alert">{error}</p>}
    <div className={styles.actions}><button className="btn btn-primary" disabled={busy || (upload && (!file || file.size > 20 * 1024 * 1024))} onClick={() => void act(true)}>{busy ? "Transferring…" : upload ? "Approve and send file" : "Approve and save file"}</button><button className="btn btn-ghost" disabled={busy} onClick={() => void act(false)}>Reject</button></div>
  </section>;
}
