"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FieldError } from "@/components/ui/FieldError";
import type { SlackSettingsInput, SlackStatus } from "@/lib/integrations/slack/shared";
import { FormField } from "./FormField";

export function TeamSlackSettings({ status, changed, persist, onBusy }: {
  status: SlackStatus;
  changed: (status: SlackStatus) => Promise<unknown>;
  persist: (input: SlackSettingsInput) => Promise<unknown>;
  onBusy?: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState(status.settings.gatewayUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(Date.now);
  const pending = useRef(false);
  const gateway = status.gateway;
  const bound = gateway?.binding && !gateway.revoked;
  const linked = bound && !gateway.pending;
  const expiresAt = gateway?.expiresAt;
  const expired = !!expiresAt && expiresAt <= now;
  const connection = status.settings.mode === "gateway" ? status.connection : undefined;
  useEffect(() => {
    if (!expiresAt || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), expiresAt - now);
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  async function action(action: "connect" | "unlink" | "confirm") {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusy?.(true); setFailure("");
    try {
      const response = await fetch("/api/integrations/slack/gateway", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "connect" ? { action, url } : action === "confirm" ? { action, deviceId: gateway?.deviceId, userId: gateway?.binding?.userId } : { action }) });
      const result: SlackStatus & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't connect to Team Slack.");
      await changed(result);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Couldn't connect to Team Slack."); }
    finally { pending.current = false; setBusy(false); onBusy?.(false); }
  }

  async function posting(field: "postNeedsYou" | "postProgress", value: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusy?.(true); setFailure("");
    try { await persist({ [field]: value }); }
    catch { setFailure("Couldn't save the posting preference. Try again."); }
    finally { pending.current = false; setBusy(false); onBusy?.(false); }
  }

  return <div className="space-y-4">
    <p className="text-sm text-text-subtle">One Slack app for the team. Your code, tools, plugins and credentials stay on this laptop.</p>
    <div role="status" aria-live="polite" className="tone-panel tone-panel--muted text-sm">
      {bound && gateway.pending ? `Is @${gateway.binding!.userName} you? Slack messages stay blocked until you confirm here.`
        : linked ? `Linked as @${gateway.binding!.userName}. ${connection?.state === "connected" ? "Connected." : connection?.state === "reconnecting" || connection?.state === "connecting" ? "Reconnecting…" : "Offline — open DevHub to reconnect."}`
        : gateway?.revoked ? "This device is unlinked. Connect again to get a new code."
        : expired ? "That link code expired. Connect again for a new one."
        : gateway?.code ? "Waiting for you to link in Slack…" : "Not connected to Team Slack."}
    </div>
    {bound ? <p className="text-xs text-text-muted">Gateway: <span className="break-all font-mono">{gateway.url}</span>. Unlink before changing gateway.</p>
      : <FormField label="Gateway URL" value={url} onChange={setUrl} placeholder="https://devhub-gateway.example.com" hint="Ask your Slack app administrator for the gateway URL. HTTPS is required except on localhost." />}
    {gateway?.code && !expired && !gateway.revoked && <div className="tone-panel tone-panel--muted space-y-2" role="status">
      <p className="text-sm">DM @DevHub: <code className="select-all font-mono">link {gateway.code}</code></p>
      <p className="text-xs text-text-muted">One-time code. Expires in ten minutes. This page updates when you’re linked.</p>
    </div>}
    {bound && gateway.pending ? <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void action("confirm")}>{busy ? "Saving…" : `Yes, that's me (@${gateway.binding!.userName})`}</button>
      <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void action("unlink")}>Not me — unlink</button>
    </div> : linked ? <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void action("unlink")}>{busy ? "Unlinking…" : "Unlink"}</button>
      : <button type="button" className="btn btn-primary" disabled={busy || !url.trim()} onClick={() => void action("connect")}>{busy ? "Connecting…" : "Connect to team Slack"}</button>}
    {linked && <div className="space-y-2">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={status.settings.postNeedsYou !== false} onChange={(event) => void posting("postNeedsYou", event.target.checked)} />Post Needs you to Slack</label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={status.settings.postProgress !== false} onChange={(event) => void posting("postProgress", event.target.checked)} />Post agent progress to Slack</label>
      <p className="text-xs text-text-muted">Posts go to your own DM and App Home. Nothing is queued while your laptop is offline.</p>
    </div>}
    {failure && <div role="alert"><FieldError>{failure}</FieldError></div>}
    <Link href="/docs/slack-gateway" className="text-sm underline underline-offset-4">Gateway setup and security</Link>
  </div>;
}
