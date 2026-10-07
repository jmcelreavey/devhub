"use client";

import { useState } from "react";
import type { PaseoUpdate } from "@/lib/paseo/update";
import QRCode from "qrcode";
import { RotateCw, Smartphone } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ProviderError } from "@/components/agents/ProviderError";
import Link from "next/link";

interface ProviderRow { id: string; label: string; ready: boolean; error?: string }
interface PaseoStatus {
  installed: boolean; running: boolean; version: string | null; web: string; relayEnabled: boolean;
  providers: ProviderRow[] | null; defaultProvider: string | null; authFailed: boolean; error?: string;
}
async function post(body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/paseo/managed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Paseo did not respond.");
  return data;
}

/** Daemon health, default agent and phone access. */
export function PaseoConnection({ setup = false }: { setup?: boolean }) {
  const { data, error: loadError, mutate } = useLive<PaseoStatus>("/api/paseo/managed", { refreshInterval: 15_000 });
  const { data: update, mutate: refreshUpdate } = useLive<PaseoUpdate>("/api/paseo/update", { refreshInterval: 60 * 60 * 1000 });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<{ url: string; qr: string }>();

  async function act(action: string, extra: Record<string, string> = {}) {
    setBusy(action); setError("");
    try {
      const result = await post({ action, ...extra });
      if (action === "pair" && typeof result.url === "string") {
        setPairing({ url: result.url, qr: await QRCode.toDataURL(result.url, { margin: 1, width: 220 }) });
      }
      if (action === "unpair") setPairing(undefined);
      await Promise.all([mutate(), refreshUpdate()]);
    } catch (err) { setError(err instanceof Error ? err.message : "Paseo did not respond."); }
    finally { setBusy(undefined); }
  }

  const updateReady = update?.canUpdate === true;
  const spinner = (action: string) => busy === action && <RotateCw size={14} className="animate-spin" />;
  if (!data && loadError) return <div className="max-w-xl p-6 mx-auto"><FetchError message={loadError.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <div className="max-w-xl p-6 mx-auto"><SkeletonRows count={4} height={48} /></div>;

  return <div className={setup ? "space-y-4 mb-6" : "max-w-xl p-6 mx-auto space-y-5"}>
    <div>
      <h2 className="text-xl font-semibold">Paseo</h2>
      <p className="text-sm text-text-muted mt-2">Paseo runs your coding agents on this machine. {setup ? "Set it up here if you want agent chats, or skip it for now. An existing daemon is detected automatically." : "DevHub starts tasks in it and follows them to a result; the chats live in Paseo."}</p>
    </div>

    {loadError && <FetchError message={loadError.message} onRetry={() => void mutate()} />}
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`tone-dot tone-dot--sm ${data.running ? "tone-dot--success" : "tone-dot--danger"}`} aria-hidden />
        <h3 className="font-medium">{data.running ? "Running" : data.installed ? "Stopped" : "Not set up"}</h3>
        {data.version && <span className="badge badge-muted">v{data.version}</span>}
        <span className="text-xs text-text-subtle ml-auto">{data.web}</span>
      </div>
      {data.authFailed && <p className="tone-panel tone-panel--warning text-sm">Paseo is already running, but DevHub could not connect. Enter its existing Agents password in <Link href="/setup" className="underline">Setup</Link>, then restart DevHub and retry. Reinstalling is not required.</p>}
      {update?.available && <p className="text-sm">Paseo {update.latest} has been published. {updateReady ? "Updating restarts Paseo; finish active chats first." : "It is waiting for Safe-Chain’s package safety window. DevHub will keep checking."}</p>}
      {update?.error && <p className="text-sm text-text-muted">{update.error}</p>}
      <div className="flex gap-3 flex-wrap">
        {updateReady && <button type="button" className="btn btn-primary gap-2" disabled={Boolean(busy)} onClick={() => void act("update")}>{spinner("update")}Update to {update?.installable}</button>}
        <button type="button" className={`btn ${data.installed ? "btn-ghost" : "btn-primary"} gap-2`} disabled={Boolean(busy)} onClick={() => void act("setup")}>{spinner("setup")}{data.installed ? "Reinstall" : "Set up Paseo"}</button>
        {data.installed && <button type="button" className="btn btn-ghost gap-2" disabled={Boolean(busy)} onClick={() => void act("restart")}>{spinner("restart")}Restart</button>}
        {data.installed && <button type="button" className="btn btn-ghost gap-2" disabled={Boolean(busy)} onClick={() => void act("check-update")}>{spinner("check-update")}Check for updates</button>}
      </div>
      {(error || data.error) && <p className="tone-panel tone-panel--warning text-sm" role="alert">{error || data.error}</p>}
    </div>

    {update?.installed &&<p className="text-xs text-text-subtle">Updates are checked when DevHub opens and hourly while it is open. Your chats, providers and plugins are kept.</p>}

    {data.providers && <div className="card p-5 space-y-3">
      <h3 className="font-medium">Agents</h3>
      <ul className="space-y-1.5 text-sm">{data.providers.map((p) => <li key={p.id} className="flex items-start gap-2">
        <span className={`tone-dot tone-dot--sm mt-1.5 ${p.ready ? "tone-dot--success" : "tone-dot--warning"}`} aria-hidden />
        <div className="flex-1 min-w-0">{p.error ? <ProviderError provider={p.label} error={p.error} onRepair={busy ? undefined : () => void act("repair-opencode-mcp")} /> : p.label}</div>
      </li>)}</ul>
      <label className="block text-sm">Default agent for background work
        <select className="input w-full mt-1" disabled={Boolean(busy)} value={data.defaultProvider ?? ""} onChange={(e) => void act("default-provider", { provider: e.target.value })}>
          {data.providers.filter((p) => p.ready).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-text-subtle">Supported agent CLIs are checked daily and updated when chats are idle. Codex from the ChatGPT app follows the app&apos;s updates.</p>
      <p className="text-xs text-text-subtle">Scheduled jobs with their own agent choice keep that choice.</p>
    </div>}

    {data.installed && !setup && <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2"><Smartphone size={16} /><h3 className="font-medium">Phone access</h3>{data.relayEnabled && <span className="badge badge-success">On</span>}</div>
      <p className="text-sm text-text-muted">Pairs the Paseo phone app through Paseo&apos;s relay. Traffic is end-to-end encrypted; the relay can&apos;t read it. Your code stays on this machine.</p>
      {pairing && <div className="flex gap-4 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser */}
        <img src={pairing.qr} alt="Pairing QR code" width={220} height={220} className="rounded bg-white" />
        <div className="text-sm space-y-2">
          <p>Scan with the Paseo app, or paste the link into it.</p>
          <p className="text-xs text-text-muted">Treat this like a password. Anyone with it can control your agents.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void copyTextToClipboard(pairing.url).catch(() => setError("Could not copy the pairing link."))}>Copy pairing link</button>
        </div>
      </div>}
      <div className="flex gap-3">
        <button type="button" className="btn btn-primary gap-2" disabled={Boolean(busy) || !data.running} onClick={() => void act("pair")}>{spinner("pair")}{data.relayEnabled ? "Show pairing code" : "Pair a phone"}</button>
        {data.relayEnabled && <button type="button" className="btn btn-ghost gap-2" disabled={Boolean(busy)} onClick={() => void act("unpair")}>{spinner("unpair")}Turn off phone access</button>}
      </div>
    </div>}
  </div>;
}
