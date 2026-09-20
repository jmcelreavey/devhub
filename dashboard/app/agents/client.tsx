"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpCircle, RotateCw } from "lucide-react";
import Activity from "@/app/agent-activity/client";
import { useLive } from "@/lib/hooks/use-fetch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import type { AionAssistant } from "@/lib/aionui/contracts";

export default function AgentsPage() {
  const params = useSearchParams();
  const view = params.get("view") || "chats";
  return <div>
    <header className="flex items-center gap-4 px-5 border-b border-border" style={{ height: 57 }}>
      <h1 className="text-sm font-semibold mr-2">Agents</h1>
      {[["chats", "Chats"], ["activity", "Activity"], ["archive", "Archive"], ["connection", "Connection"]].map(([id, label]) => <Link key={id} href={id === "chats" ? "/agents" : `/agents?view=${id}`} className={view === id ? "text-sm text-accent" : "text-sm text-text-muted"} aria-current={view === id ? "page" : undefined}>{label}</Link>)}
      <AionUpdatePill />
    </header>
    {view === "activity" && <Activity />}
    {view === "archive" && <Archives />}
    {view === "connection" && <Connection />}
  </div>;
}

function AionUpdatePill() {
  const { data, mutate } = useLive<{ available: boolean; currentVersion?: string; latestVersion?: string }>("/api/aionui/managed", { refreshInterval: 60 * 60_000 });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  if (!data?.available && !error) return null;
  async function update() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/aionui/managed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Update failed.");
      await mutate();
      window.location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Update failed."); }
    finally { setBusy(false); }
  }
  if (error) return <span className="text-xs text-danger" title={error}>Update failed</span>;
  return <button type="button" onClick={() => confirming ? void update() : setConfirming(true)} onBlur={() => setConfirming(false)} disabled={busy} className="badge badge-accent ml-auto inline-flex items-center gap-1.5" title={`Update managed AionUi ${data?.currentVersion} → ${data?.latestVersion}. Conversations are preserved.`}>
    {busy ? <RotateCw size={12} className="animate-spin" /> : <ArrowUpCircle size={12} />}{busy ? "Updating…" : confirming ? "Update now?" : `AionUi ${data?.latestVersion} available`}
  </button>;
}

function Connection() {
  const router = useRouter();
  const { data: connection, mutate } = useLive<{ connected: boolean; origin: string; defaultAssistantId: string; assistants: AionAssistant[] }>("/api/aionui/connection", { refreshInterval: 0 });
  const [origin, setOrigin] = useState("http://127.0.0.1:25808");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function chooseDefault(assistantId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/aionui/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "default-assistant", assistantId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the default agent.");
      await mutate();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the default agent."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/aionui/managed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not prepare the workspace.");
      router.push("/agents");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare the workspace."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/aionui/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", origin, username, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not connect.");
      setPassword("");
      router.push("/agents");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect."); }
    finally { setBusy(false); }
  }
  return <div className="max-w-xl p-6 mx-auto">
    <h2 className="text-xl font-semibold">Connect your AI workspace</h2>
    <p className="text-sm text-text-muted mt-2 mb-6">AionUi keeps your coding conversations together. DevHub sends tasks to the agent you choose and tracks their progress here.</p>
    {connection?.connected && <div className="card p-5 mb-5 space-y-3"><p className="text-sm text-text-muted">Connected to {connection.origin}</p><label className="block text-sm">Default agent for background work<select disabled={busy} className="input w-full mt-1" value={connection.defaultAssistantId} onChange={event => void chooseDefault(event.target.value)}>{connection.assistants.filter(assistant => assistant.enabled && assistant.agent_status === "online").map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label><p className="text-xs text-text-subtle">Scheduled jobs with their own agent choice keep that choice.</p></div>}
    <div className="card p-5 mb-5 space-y-3">
      <h3 className="font-medium">Local workspace</h3>
      <p className="text-sm text-text-muted">Install or start the tested AionUi release on this Mac. Setup keeps its history on this computer and applies DevHub&apos;s Graphite Neon theme.</p>
      <button type="button" className="btn btn-primary gap-2" disabled={busy} onClick={() => void prepare()}>{busy && <RotateCw size={14} className="animate-spin" />}Set up local workspace</button>
    </div>
    <h3 className="font-medium mb-3">Or connect an existing workspace</h3>
    <form onSubmit={submit} className="card p-5 space-y-4">
      <label className="block text-sm">AionUi web address<input className="input w-full mt-1" type="url" required value={origin} onChange={(e) => setOrigin(e.target.value)} /></label>
      <label className="block text-sm">Username<input className="input w-full mt-1" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
      <label className="block text-sm">Password<input className="input w-full mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary gap-2" type="submit" disabled={busy}>{busy && <RotateCw size={14} className="animate-spin" />}{busy ? "Connecting…" : "Connect workspace"}</button>
    </form>
    <p className="text-xs text-text-subtle mt-4">Supports AionUi 2.2.2 with AionCore 0.2.2 in authenticated WebUI mode. Your password is used to sign in and is not saved.</p>
  </div>;
}

function Archives() {
  const { data, error } = useLive<{ archives: { id: string; createdAt: number; bytes: number }[] }>("/api/aionui/legacy-archive", { refreshInterval: 0 });
  return <div className="max-w-2xl mx-auto p-6 space-y-4">
    <h2 className="text-xl font-semibold">Previous DevHub chats</h2>
    <p className="text-sm text-text-muted">Saved chats from the former terminal chat are archived here. Original browser copies remain available if an export needs to be retried.</p>
    {error ? <p role="alert" className="text-danger">Could not load the archive. Reload to retry.</p> : !data ? <SkeletonRows count={3} height={48} /> : data.archives.length === 0 ? <p className="text-text-muted">No saved chats were found in this browser yet. Open DevHub in each browser you used to collect its history.</p> : <ul className="space-y-3">{data.archives.map(a => <li key={a.id} className="card p-4 flex justify-between gap-3"><span>{new Date(a.createdAt).toLocaleString()} · {Math.ceil(a.bytes / 1024)} KB</span><a className="text-accent underline" href={`/api/aionui/legacy-archive?id=${a.id}&download=1`}>Download archive</a></li>)}</ul>}
  </div>;
}
