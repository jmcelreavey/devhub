"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { EVENT_LABELS, alertText, type Destination, type AlertEntry, type AlertKind } from "@/lib/integrations/alert-types";
import { isPrAlert, prAnnouncementText } from "@/lib/integrations/pr-announcement";
import { postIntegration } from "./request";
import TelegramChatId from "./TelegramChatId";
import styles from "./integrations.module.css";
interface Data { profile: string; destinations: Omit<Destination, "credentialHash">[]; outbox: AlertEntry[] }
function prPreview(kind: "pr-reviewed" | "pr-ready") {
  return prAnnouncementText(kind, { url: "https://github.com/owner/repo/pull/123", title: "Fix the retry", verdict: "pass", notes: 2, jira: "PTF-1234" }, "UOWNER")
    .replace("<@UOWNER>", "@you").replace(/<https:\/\/[^|]+\|([^>]+)>/g, "$1");
}
export default function Alerts() {
  const { data, error, mutate } = useLive<Data>("/api/integrations/alerts", { refreshInterval: 10000 });
  const [editing, setEditing] = useState<Omit<Destination, "credentialHash"> | null>(null);
  const formDetails = useRef<HTMLDetailsElement>(null); const draftId = useRef("");
  const [includePrDetails, setIncludePrDetails] = useState(false); const [consented, setConsented] = useState(false);
  const [channel, setChannel] = useState("slack"); const [quiet, setQuiet] = useState(false);
  const [credentialRef, setCredentialRef] = useState(""); const [chatId, setChatId] = useState("");
  const [testing, setTesting] = useState(""); const testRequests = useRef<Record<string, string>>({});
  const [base, setBase] = useState(""); const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [failure, setFailure] = useState(""); const [message, setMessage] = useState("");
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  async function act(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure(""); setMessage("");
    try { await work(); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Could not update alerts."); }
    finally {
      try { await mutate(); }
      catch { setFailure("Could not refresh deliveries. Refresh the page to check the recorded outcome."); }
      pending.current = false; setBusy(false);
    }
  }
  if (error) return <section id="alerts" className={styles.section}><h2>Workflow alerts</h2><FetchError message={error.message} onRetry={() => void mutate()} /></section>;
  if (!data) return <section id="alerts" className={styles.section}><h2>Workflow alerts</h2><SkeletonRows count={3} /></section>;
  function edit(destination: Omit<Destination, "credentialHash">) {
    setIncludePrDetails(Boolean(destination.includePrDetails)); setConsented(false);
    setEditing(destination); setCredentialRef(destination.credentialRef); setChatId(destination.chatId ?? ""); setChannel(destination.provider); setBase(destination.publicBaseUrl ?? ""); setQuiet(Boolean(destination.quiet));
    if (formDetails.current) { formDetails.current.open = true; formDetails.current.scrollIntoView({ block: "start" }); }
  }
  async function test(destination: Omit<Destination, "credentialHash">) {
    const key = destination.id + ":" + destination.revision;
    testRequests.current[key] ||= crypto.randomUUID(); setTesting(destination.id);
    try {
      const result = await postIntegration({ action: "test", id: destination.id, revision: destination.revision, requestId: testRequests.current[key] }, true);
      delete testRequests.current[key];
      if (result.delivery.state !== "sent") throw new Error(destination.label + ": " + result.delivery.detail);
      setMessage("Test message sent to " + destination.label + ". The provider accepted it; check the chat to confirm receipt.");
    } finally { setTesting(""); }
  }
  async function revoke(d: Omit<Destination, "credentialHash">) {
    const { revision, consentAt: _consentAt, ...destination } = d;
    void _consentAt;
    await postIntegration({ action: "save", destination: { ...destination, enabled: false }, revision, consent: true }, true);
    setMessage("Alerts revoked. Queued deliveries are cancelled; messages already sent remain in the channel.");
  }
  return <section id="alerts" className={styles.section}><h2>Workflow alerts</h2><p>Send selected updates for work profile <strong>{data.profile}</strong>. Alerts are off until you enable a destination. Choose a Slack channel or an explicit Telegram chat. WhatsApp remains unavailable.</p>
    <p className={styles.meta}>Want task answers in Slack? <Link href="/setup#slack">Connect the Slack bot</Link>. Bot settings live in Setup; existing webhook and Telegram alerts stay here.</p>
    {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}{message && <p role="status" className="tone-panel tone-panel--muted">{message}</p>}
    {data.destinations.length ? <ul className={styles.list}>{data.destinations.map((d) => <li key={d.id}><div className={styles.item}><div><strong>{d.label}</strong><p className={styles.meta}>{d.provider} · {d.enabled ? "Enabled" : "Revoked"} · {d.events.map((kind) => EVENT_LABELS[kind]).join(", ")}</p>{d.quiet && <p className={styles.meta}>Quiet {d.quiet.start}–{d.quiet.end} ({d.quiet.timeZone})</p>}</div><div className={styles.actions}><button className="btn btn-ghost" disabled={busy} onClick={() => edit(d)}>{d.enabled ? "Change settings" : "Review and re-enable"}</button>{d.enabled && <button className="btn btn-ghost" disabled={busy} onClick={() => void act(() => test(d))}>{testing === d.id ? "Sending test…" : "Send test message"}</button>}{d.enabled && <button className="btn btn-danger-ghost" disabled={busy} onClick={() => void act(() => revoke(d))}>Revoke alerts</button>}</div></div></li>)}</ul> : <p className={styles.status}>No destinations enabled. Nothing is sent outside DevHub.</p>}
    <details ref={formDetails}><summary>{editing ? "Review consent for " + editing.label : "Enable a destination"}</summary>
      <form key={editing?.id + ":" + editing?.revision} className={styles.form} onChange={(event) => { if (!(event.target instanceof HTMLInputElement && event.target.name === "consent")) setConsented(false); }} onSubmit={(e) => {
        e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form);
        draftId.current ||= crypto.randomUUID();
        const destination = { id: editing?.id ?? draftId.current, label: fields.get("label"), provider: channel, workProfile: data.profile, credentialRef: fields.get("credentialRef"), events: fields.getAll("events"), enabled: true, includePrDetails: channel === "slack" && includePrDetails,
          ...(channel === "telegram" ? { chatId: fields.get("chatId") } : {}), ...(base ? { publicBaseUrl: base } : {}),
          ...(quiet ? { quiet: { start: fields.get("start"), end: fields.get("end"), timeZone: fields.get("timeZone") } } : {}) };
        void act(async () => { await postIntegration({ action: "save", destination, revision: editing?.revision ?? 0, consent: true }, true); form.reset(); setEditing(null); setIncludePrDetails(false); setConsented(false); draftId.current = ""; setBase(""); setCredentialRef(""); setChatId(""); if (formDetails.current) formDetails.current.open = false; setMessage("Alerts enabled for future matching events. No test message was sent."); });
      }}>
        <label>Channel<select className="input" value={channel} onChange={(e) => { setChannel(e.target.value); if (!editing) setCredentialRef(""); setChatId(""); }}><option value="slack">Slack incoming webhook</option><option value="telegram">Telegram bot</option></select></label>
        <label>Destination label<input className="input" name="label" defaultValue={editing?.label} required maxLength={80} placeholder={channel === "slack" ? "#dev-alerts" : "My work chat"} /></label>
        <label>{channel === "slack" ? "Webhook variable name" : "Bot token variable name"}<input className="input" name="credentialRef" value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} required pattern="[A-Z][A-Z0-9_]+" maxLength={128} placeholder={channel === "slack" ? "DEVHUB_SLACK_WEBHOOK" : "DEVHUB_TELEGRAM_TOKEN"} /></label>
        <p className={styles.meta}>Set the secret in the server environment and restart DevHub first. Enter its variable name here.{channel === "slack" && " The Slack webhook determines the recipient channel."}</p>
        {channel === "telegram" && <TelegramChatId key={credentialRef} credentialRef={credentialRef} chatId={chatId} onChange={setChatId} disabled={busy} />}
        <fieldset className={styles.checks}><legend>Send these events</legend>{Object.entries(EVENT_LABELS).map(([kind, label]) => <label key={kind}><input type="checkbox" name="events" value={kind} defaultChecked={editing ? editing.events.includes(kind as AlertKind) : !isPrAlert(kind)} />{label}</label>)}</fieldset>
        {channel === "slack" && <><label className={styles.check}><input type="checkbox" checked={includePrDetails} onChange={(event) => setIncludePrDetails(event.target.checked)} />Share PR details and tag me in this channel</label><p className={styles.meta}>For the two PR events above, share the repo, PR number, title, GitHub link and a short review verdict when available. Everyone in the channel can read them. Only the owner configured in <Link href="/setup#slack">Setup → Slack</Link> is tagged. Off by default; changing this needs fresh consent.</p></>}
        <label>Secure DevHub address (optional)<input className="input" type="url" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://devhub.example.com" /><span className={styles.meta}>Use an authenticated HTTPS address reachable from your phone. Leave blank to send no link; localhost would point at the phone.</span></label>
        <label className={styles.check}><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />Use quiet hours</label>
        {quiet && <><div className={styles.row}><label>Start<input className="input" type="time" name="start" defaultValue={editing?.quiet?.start ?? "22:00"} required /></label><label>End<input className="input" type="time" name="end" defaultValue={editing?.quiet?.end ?? "08:00"} required /></label></div><label>Time zone<input className="input" name="timeZone" defaultValue={editing?.quiet?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} required /></label></>}
        <div><h3>Message preview</h3>{channel === "slack" && includePrDetails ? <><p className={styles.preview}>{prPreview("pr-reviewed")}</p><p className={styles.preview}>{prPreview("pr-ready")}</p><p className={styles.meta}>Slack will show your name in place of @you, with a link to the PR. PR details leave DevHub only for the PR events you select. Other alerts keep their minimal text. No diffs, logs or conversations. Approvals stay in DevHub.</p></> : <><p className={styles.preview}>{alertText("approval-ready", "example", base || undefined)}</p><p className={styles.meta}>Only the event summary and optional task link leave DevHub. No task titles, code, logs or conversations. Approvals stay in DevHub.</p></>}</div>
        <label className={styles.check}><input type="checkbox" name="consent" required checked={consented} onChange={(event) => setConsented(event.target.checked)} />I approve these event templates for this destination and work profile, including its external recipients and storage.</label>
        <div className={styles.actions}><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save and enable alerts" : "Enable alerts"}</button>{editing && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setEditing(null); setIncludePrDetails(false); setConsented(false); setBase(""); setQuiet(false); setCredentialRef(""); setChatId(""); }}>Cancel changes</button>}</div>
      </form>
    </details>
    <h3>Recent deliveries</h3><p className={styles.meta}>Provider acceptance does not prove the recipient read it. Unknown deliveries require a channel check before retrying.</p>
    {data.outbox.length ? <ul className={styles.list}>{data.outbox.map((entry) => <li key={entry.id}><strong>{entry.kind === "test" ? "Test message" : EVENT_LABELS[entry.kind]}</strong><p className={styles.meta}>{data.destinations.find((d) => d.id === entry.destinationId)?.label || "Removed destination"} · {entry.state === "unknown" ? "Delivery unknown" : entry.state} · {new Date(entry.createdAt).toLocaleString()}</p>{entry.detail && <p>{entry.detail}</p>}
      {["unknown", "failed"].includes(entry.state) && <div className={styles.actions}><label className={styles.check}><input type="checkbox" checked={!!acknowledged[entry.id]} onChange={(e) => setAcknowledged({ ...acknowledged, [entry.id]: e.target.checked })} />I checked the channel; retrying could send a duplicate.</label><button className="btn btn-ghost" disabled={busy || !acknowledged[entry.id]} onClick={() => void act(async () => { await postIntegration({ action: "delivery", id: entry.id, retry: true, acknowledgeDuplicate: true }, true); })}>Retry delivery</button></div>}
      {["pending", "unknown", "failed"].includes(entry.state) && <button className="btn btn-ghost" disabled={busy} onClick={() => void act(async () => { await postIntegration({ action: "delivery", id: entry.id, retry: false, acknowledgeDuplicate: false }, true); })}>Cancel delivery</button>}
    </li>)}</ul> : <p className={styles.status}>No deliveries yet. Only events after consent are queued.</p>}
  </section>;
}
