"use client";

import Link from "@/lib/navigation";
import { useState } from "react";
import { PageHeader, FetchError } from "@/components";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";

interface Inventory { files: number; bytes: number; stores: Array<{ id: string; files: number }> }
export function RecoveryPage() {
  const inventory = useLive<Inventory>("/api/recovery", { refreshInterval: 0 });
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [parent, setParent] = useState("");
  const [repositoriesRoot, setRepositoriesRoot] = useState("");
  const [file, setFile] = useState<File>();
  const [pending, setPending] = useState<"backup" | "restore">();
  const [failure, setFailure] = useState("");
  const [download, setDownload] = useState<string>();
  const [restored, setRestored] = useState<{ destination: string; files: number }>();
  async function backup() {
    setPending("backup"); setFailure(""); setDownload(undefined);
    try {
      const response = await fetch("/api/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn’t create the backup.");
      setDownload(result.downloadUrl);
      setPassphrase(""); setConfirmation("");
      const anchor = document.createElement("a");
      anchor.href = result.downloadUrl; anchor.download = "";
      anchor.click();
    } catch (error) { setFailure(error instanceof Error ? error.message : "Couldn’t create the backup."); }
    finally { setPending(undefined); }
  }
  async function restore() {
    if (!file) return;
    setPending("restore"); setFailure(""); setRestored(undefined);
    try {
      const options = encodeURIComponent(JSON.stringify({ passphrase: restorePassphrase, parent: parent || undefined, repositoriesRoot: repositoriesRoot || undefined }));
      if (options.length > 8_000) throw new Error("The recovery paths or passphrase are too long. Use the recovery CLI for this backup.");
      const response = await fetch("/api/recovery/restore", { method: "POST", headers: {
        "Content-Type": "application/octet-stream",
        "X-DevHub-Recovery": options,
      }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn’t restore the backup.");
      setRestored(result); setRestorePassphrase("");
    } catch (error) { setFailure(error instanceof Error ? error.message : "Couldn’t restore the backup."); }
    finally { setPending(undefined); }
  }
  return <div className="page-wrapper h-full overflow-y-auto max-w-5xl">
    <PageHeader title="Backup and recovery" subtitle="Keep a verified, encrypted copy of your DevHub data." />
    <Link href="/setup" className="mb-5 inline-block text-sm text-text-muted">Back to Setup</Link>
    {failure ? <div role="alert" className="tone-panel tone-panel--warning mb-4">{failure}</div> : null}
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card card-body space-y-4" aria-label="Create encrypted backup">
        <h2 className="text-lg font-medium">Create a backup</h2>
        <p className="text-sm text-text-secondary">Notes, tasks, media, local databases, agent history and configuration travel together. Every file is checked before the download is ready.</p>
        {inventory.isLoading ? <SkeletonRows count={2} /> : inventory.error ? <FetchError message={inventory.error.message} onRetry={() => void inventory.mutate()} /> :
          inventory.data ? <details className="text-xs text-text-muted"><summary className="cursor-pointer">{inventory.data.files.toLocaleString()} files · {(inventory.data.bytes / 1_048_576).toFixed(1)} MiB · View included stores</summary><ul className="mt-2 space-y-1">{inventory.data.stores.map(store => <li key={store.id}>{store.id} · {store.files.toLocaleString()} files</li>)}</ul></details> : null}
        <label className="block text-sm">Backup passphrase<input className="input mt-1 w-full" type="password" autoComplete="new-password" minLength={12} maxLength={1024} disabled={!!pending} value={passphrase} onChange={event => setPassphrase(event.target.value)} /></label>
        <label className="block text-sm">Confirm passphrase<input className="input mt-1 w-full" type="password" autoComplete="new-password" maxLength={1024} disabled={!!pending} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {confirmation && confirmation !== passphrase ? <p role="status" className="text-xs text-error">The passphrases do not match.</p> : null}
        <p className="text-xs text-text-muted">Use at least 12 characters and keep it somewhere safe. DevHub cannot recover this passphrase. Pause edits while the backup is being captured.</p>
        <button type="button" className="btn btn-primary" disabled={!!pending || passphrase.length < 12 || passphrase !== confirmation} onClick={() => void backup()}>{pending === "backup" ? "Creating and verifying…" : "Create encrypted backup"}</button>
        {download ? <p role="status" className="text-sm">Backup verified. <a className="underline" href={download} download>Download again</a> within 15 minutes.</p> : null}
      </section>
      <section className="card card-body space-y-4" aria-label="Restore to a new folder">
        <h2 className="text-lg font-medium">Restore into a new folder</h2>
        <p className="text-sm text-text-secondary">Verify a backup in a fresh folder, then review its recovered stores and reconnect them in Setup.</p>
        <label className="block text-sm">DevHub backup<input type="file" accept=".devhub" className="mt-2 block w-full text-sm" disabled={!!pending} onChange={event => setFile(event.target.files?.[0])} /></label>
        <label className="block text-sm">Backup passphrase<input className="input mt-1 w-full" type="password" autoComplete="off" maxLength={1024} disabled={!!pending} value={restorePassphrase} onChange={event => setRestorePassphrase(event.target.value)} /></label>
        <details className="text-sm"><summary className="cursor-pointer">Folder and repository remapping</summary>
          <label className="mt-3 block">Parent folder<input className="input mt-1 w-full" placeholder="Your home folder by default" disabled={!!pending} value={parent} onChange={event => setParent(event.target.value)} /></label>
          <label className="mt-3 block">New repositories root<input className="input mt-1 w-full" placeholder="Keep original repository paths" disabled={!!pending} value={repositoriesRoot} onChange={event => setRepositoriesRoot(event.target.value)} /></label>
        </details>
        <p className="text-xs text-text-muted">The passphrase, authentication tag and file hashes must match. Failed restores remove their temporary files. Keychain secrets and external databases need reconnection; plugin source repositories need relinking.</p>
        <button type="button" className="btn btn-ghost" disabled={!!pending || !file || restorePassphrase.length < 12 || file.size > 128 * 1_048_576} onClick={() => void restore()}>{pending === "restore" ? "Verifying and restoring…" : "Restore to a new folder"}</button>
        {file && file.size > 128 * 1_048_576 ? <p role="alert" className="text-xs text-error">Browser restore supports files up to 128 MiB. Use the recovery CLI for a larger bundle.</p> : null}
        {restored ? <div role="status" className="text-sm"><p>Verified {restored.files.toLocaleString()} files.</p><code className="mt-2 block break-all text-xs">{restored.destination}</code><p className="mt-2 text-xs text-text-muted">Open recovery.json there for the store paths and next steps.</p></div> : null}
      </section>
    </div>
    <p className="mt-5 text-xs text-text-muted">AES-256-GCM encryption with a derived key. Bundle limits: 1 GiB of source data, 256 MiB per file. SQLite stores use consistent snapshots.</p>
  </div>;
}
