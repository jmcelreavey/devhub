"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { FetchError } from "@/components/ui/FetchError";
import { FieldError } from "@/components/ui/FieldError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import { slackAppCreationUrl } from "@/lib/integrations/slack/manifest";
import { SlackSettingsSchema, SLACK_SECRET_MASK, type SlackDelivery, type SlackSettings, type SlackSettingsInput, type SlackStatus } from "@/lib/integrations/slack/shared";
import { FormField } from "./FormField";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { TeamSlackSettings } from "./TeamSlackSettings";

export function SlackStep({ onConfigured }: { onConfigured?: (configured: boolean) => void }) {
  const { data, error, mutate } = useLive<SlackStatus>("/api/integrations/slack/status", { refreshInterval: 5000 });
  const [draft, setDraft] = useState<SlackSettings | null>(null);
  const [visible, setVisible] = useState({ botToken: false, appToken: false });
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | "posting" | "gateway" | null>(null);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");
  const [test, setTest] = useState<SlackDelivery | null>(null);
  const [mode, setMode] = useState<"direct" | "gateway" | null>(null);
  const pending = useRef(false);
  const testRequests = useRef<Record<string, string>>({});

  useEffect(() => { if (data) onConfigured?.(data.configured); }, [data, onConfigured]);

  if (error) return <section id="slack"><h2 className="mb-2 text-xl font-semibold">Slack</h2><FetchError message="Could not read Slack settings." onRetry={() => void mutate()} /></section>;
  if (!data) return <section id="slack" aria-label="Slack setup" aria-busy="true"><h2 className="mb-4 text-xl font-semibold">Slack</h2><SkeletonRows count={3} /></section>;

  const form = draft ?? data.settings;
  const dirty = draft !== null && (Object.keys(form) as Array<keyof SlackSettings>).some((field) => {
    if ((field === "botToken" || field === "appToken") && (!form[field] || form[field] === SLACK_SECRET_MASK)) return false;
    return form[field] !== data.settings[field];
  });

  function change(field: Exclude<keyof SlackSettings, "postNeedsYou" | "postProgress">, value: string) {
    setDraft((current) => ({ ...(current ?? data!.settings), [field]: value }));
    setFailure(""); setMessage("");
  }

  async function persist(input: SlackSettingsInput | null): Promise<SlackStatus> {
    const response = await fetch("/api/integrations/slack/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result: SlackStatus & { error?: string } = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not save Slack settings.");
    await mutate(result, false);
    return result;
  }

  async function setPosting(field: "postNeedsYou" | "postProgress", enabled: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy("posting"); setFailure(""); setMessage("");
    try {
      await persist({ [field]: enabled });
      setDraft((current) => current ? { ...current, [field]: enabled } : null);
      setMessage(field === "postProgress"
        ? enabled ? "Agent progress posts are on." : "Agent progress posts are off. Existing threads still work."
        : enabled ? "Needs you posts are on for your active profile." : "Needs you posts are off. Existing threads still work.");
    } catch (caught) { setFailure(caught instanceof Error ? caught.message : "Could not save Slack settings."); }
    finally { pending.current = false; setBusy(null); }
  }

  async function save(event?: FormEvent, disconnect = false) {
    event?.preventDefault();
    if (pending.current) return;
    const parsed = SlackSettingsSchema.safeParse(form);
    if (!disconnect && !parsed.success) { setFailure(parsed.error.issues[0]?.message ?? "Check the Slack settings."); return; }
    pending.current = true; setBusy(disconnect ? "disconnect" : "save"); setFailure(""); setMessage("");
    try {
      await persist(disconnect || !parsed.success ? null : parsed.data);
      setDraft(null); setTest(null); setVisible({ botToken: false, appToken: false });
      setMessage(disconnect ? "Slack disconnected. Saved tokens removed." : "Saved. No DevHub restart needed.");
    } catch (caught) { setFailure(caught instanceof Error ? caught.message : "Could not save Slack settings."); }
    finally { pending.current = false; setBusy(null); }
  }

  async function sendTest() {
    if (pending.current || !data || !data.configured || dirty) return;
    pending.current = true; setBusy("test"); setFailure(""); setMessage("");
    const key = `${data.revision}:${data.profile}`;
    testRequests.current[key] ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/integrations/slack/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: data.revision, requestId: testRequests.current[key] }) });
      const result: { delivery?: SlackDelivery; error?: string } = await response.json();
      if (!response.ok || !result.delivery) { setFailure(result.error ?? "Could not send the test. Check Slack before trying again."); return; }
      setTest(result.delivery);
      if (result.delivery.state === "sent") setMessage(result.delivery.detail);
      else setFailure(result.delivery.detail);
    } catch { setFailure("Could not check the test outcome. Check Slack before trying again; this test keeps the same request ID."); }
    finally { pending.current = false; setBusy(null); }
  }

  async function selectMode(next: "direct" | "gateway") {
    if (pending.current) return;
    setMode(next); setFailure("");
    if (next !== "direct" || data!.settings.mode !== "gateway") return;
    pending.current = true; setBusy("save");
    try { await persist({ mode: "direct" }); setDraft(null); }
    catch { setFailure("Couldn't switch Slack mode. Try again."); setMode("gateway"); }
    finally { pending.current = false; setBusy(null); }
  }

  const modeSwitch = <ToggleGroup aria-label="Slack connection mode" value={mode ?? data.settings.mode ?? "direct"} options={[
    { value: "direct", label: "Just me (direct)", disabled: !!busy },
    { value: "gateway", label: "Team Slack (gateway)", disabled: !!busy },
  ]} onChange={(next) => void selectMode(next)} />;

  if ((mode ?? data.settings.mode) === "gateway") return <section id="slack" className="space-y-5">
    <h2 className="text-xl font-semibold">Slack</h2>
    {modeSwitch}
    <TeamSlackSettings status={data} changed={(status) => mutate(status, false)} persist={persist} onBusy={(active) => { pending.current = active; setBusy(active ? "gateway" : null); }} />
    {failure && <div role="alert"><FieldError>{failure}</FieldError></div>}
  </section>;

  return <section id="slack" className="space-y-5">
    <div>
      <h2 className="text-xl font-semibold">Slack</h2>
      <p className="mt-1 text-sm text-text-subtle">Needs you posts and task replies in one Slack channel. No public URL needed.</p>
    </div>
    {modeSwitch}
    <div className="flex flex-wrap items-center gap-3">
      <a href={slackAppCreationUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Create Slack app <ExternalLink size={14} aria-hidden /></a>
      <Link href="/docs/guides/integrations#slack" className="text-sm underline underline-offset-4">Setup steps</Link>
    </div>
    <p className="text-sm text-text-subtle">Install the app, then paste its tokens below. Invite @DevHub into your channel. Your member ID is in Slack → your profile → More → Copy member ID.</p>
    <div role="status" aria-live="polite" className="tone-panel tone-panel--muted text-sm">{data.connection.message}</div>
    <form onSubmit={(event) => void save(event)} className="space-y-4" aria-label="Slack connection settings">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Bot token" value={form.botToken} onChange={(value) => change("botToken", value)} placeholder="xoxb-…" secret={!visible.botToken} onToggleSecret={() => setVisible((current) => ({ ...current, botToken: !current.botToken }))} onFocus={() => { if (form.botToken === SLACK_SECRET_MASK) change("botToken", ""); }} hint={data.settings.botToken ? "Leave blank to keep the saved token." : "OAuth & Permissions → Bot User OAuth Token."} />
        <FormField label="App-level token" value={form.appToken} onChange={(value) => change("appToken", value)} placeholder="xapp-…" secret={!visible.appToken} onToggleSecret={() => setVisible((current) => ({ ...current, appToken: !current.appToken }))} onFocus={() => { if (form.appToken === SLACK_SECRET_MASK) change("appToken", ""); }} hint={data.settings.appToken ? "Leave blank to keep the saved token." : "Basic Information → App-Level Tokens → connections:write."} />
        <FormField label="Channel ID" value={form.channelId} onChange={(value) => change("channelId", value)} placeholder="C…" hint="Open the channel details in Slack and copy its channel ID." />
        <FormField label="Your Slack member ID" value={form.allowedUserId} onChange={(value) => change("allowedUserId", value)} placeholder="U…" hint="Only this person can ask the bot. Do not use the bot's member ID." />
      </div>
      <FormField label="Workspace ID (optional)" value={form.teamId} onChange={(value) => change("teamId", value)} placeholder="T…" hint="From your Slack workspace URL. If blank, DevHub uses the bot's authenticated workspace." />
      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text">
          <input type="checkbox" checked={form.postNeedsYou !== false} disabled={!!busy} aria-describedby="slack-posting-hint" onChange={(event) => void setPosting("postNeedsYou", event.target.checked)} />
          Post Needs you to Slack
        </label>
        <p id="slack-posting-hint" className="text-xs text-text-muted">Saves on click. Posts your active profile; reply in a task thread to answer. Retry always asks for confirmation.</p>
      </div>
      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text">
          <input type="checkbox" checked={form.postProgress !== false} disabled={!!busy} aria-describedby="slack-progress-hint" onChange={(event) => void setPosting("postProgress", event.target.checked)} />
          Post agent progress to Slack
        </label>
        <p id="slack-progress-hint" className="text-xs text-text-muted">Saves on click. Posts plan, PR, failure and question milestones in the task’s thread, or starts one if needed.</p>
      </div>
      <p className="text-xs text-text-muted">Tokens stay on this machine, never in Git. Task threads keep their original profile. Add “in personal” to scope a read-only question.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={dirty || !data.configured ? "btn btn-primary" : "btn btn-ghost"} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save Slack settings"}</button>
        <button type="button" className={!dirty && data.configured ? "btn btn-primary" : "btn btn-ghost"} disabled={!!busy || dirty || !data.configured || test?.state === "sent"} onClick={() => void sendTest()}>{busy === "test" ? "Sending…" : test?.state === "sent" ? "Test sent" : test?.state === "unknown" ? "Check test outcome" : "Send test"}</button>
      </div>
    </form>
    {message && <p role="status" className="text-sm text-text-subtle">{message}</p>}
    {failure && <div role="alert"><FieldError>{failure}</FieldError></div>}
    {Object.entries(data.settings).some(([field, value]) => field !== "postNeedsYou" && field !== "postProgress" && Boolean(value)) && <details className="text-sm text-text-subtle"><summary className="cursor-pointer">Remove connection</summary><p className="my-2">Remove both saved tokens and stop this bot. Existing Slack messages stay put.</p><button type="button" className="btn btn-danger-ghost" disabled={!!busy} onClick={() => void save(undefined, true)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect Slack"}</button></details>}
  </section>;
}
