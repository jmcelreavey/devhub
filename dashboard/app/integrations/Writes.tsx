"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLive } from "@/lib/hooks/use-fetch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { openWriteReview, proposeAndReview, writeRequest } from "@/components/integrations/WriteReview";
import { WriteInputSchema, type WriteInput, type WriteProposal } from "@/lib/integrations/write-types";
import styles from "./integrations.module.css";

interface Provider { id: string; capabilities: string[]; accounts: { id: string; label: string }[] }
interface Data { now: number; proposals: WriteProposal[]; chat: { provider: string; enabled: boolean; configured: boolean; allowed: number }[] }
const labels: Record<WriteInput["action"], string> = { "issue.create": "Create Jira ticket", "issue.transition": "Apply Jira transition", "pr.create": "Create GitHub pull request", "pr.update": "Update PR title and description", "pr.publish": "Publish draft PR for review" };
export default function Writes({ providers }: { providers: Provider[] }) {
  const { data, error, mutate } = useLive<Data>("/api/integrations/writes");
  const requestedAction = useSearchParams().get("action");
  const [action, setAction] = useState<WriteInput["action"]>(requestedAction && requestedAction in labels ? requestedAction as WriteInput["action"] : "issue.create");
  const [account, setAccount] = useState("default");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [failure, setFailure] = useState(""); const [message, setMessage] = useState("");
  const providerId = action.startsWith("issue.") ? "jira" : "github";
  const provider = providers.find((p) => p.id === providerId);
  async function act(work: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure(""); setMessage("");
    try { await work(); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Could not prepare the action. Your input has been kept."); }
    finally {
      try { await mutate(); }
      catch { setFailure("Could not refresh recent actions. Refresh the page to check the recorded outcome."); }
      pending.current = false; setBusy(false);
    }
  }
  function submit(form: HTMLFormElement) {
    const f = new FormData(form); const value = (name: string) => String(f.get(name) ?? "");
    const input: Record<string, unknown> = { action, provider: providerId, account };
    if (action === "issue.create") Object.assign(input, { projectKey: value("projectKey"), title: value("title"), body: value("body"), parentKey: value("parentKey") || null, assignToMe: f.has("assignToMe"), sprintId: value("sprintId") ? Number(value("sprintId")) : null });
    if (action === "pr.create") Object.assign(input, { repo: value("repo"), head: value("head"), base: value("base"), title: value("title"), body: value("body"), draft: f.has("draft") });
    if (["issue.transition", "pr.update", "pr.publish"].includes(action)) input.ref = { provider: providerId, account, kind: providerId === "jira" ? "issue" : "pr", id: value("id") };
    if (action === "issue.transition") input.transitionId = value("transitionId");
    if (action === "pr.update") Object.assign(input, { title: value("title"), body: value("body") });
    void act(async () => {
      const parsed = WriteInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
      const result = await proposeAndReview(parsed.data);
      if (!result) setMessage("Action cancelled. Nothing was sent.");
      else if (result.state === "succeeded") setMessage(result.detail ?? "Action completed.");
      else setFailure(result.detail ?? "Check the action's recorded outcome below.");
    });
  }
  const field = (name: string, label: string, placeholder?: string, required = true) => <label>{label}<input className="input" name={name} placeholder={placeholder} required={required} maxLength={255} /></label>;
  return <>
    <section id="actions" className={styles.section}><h2>Write actions</h2><p>Prepare a ticket or pull request, then review the exact account, destination and content. Every action needs its own confirmation.</p>
      {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}
      {message && <p role="status" className="tone-panel tone-panel--muted">{message}</p>}
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
        <fieldset disabled={busy} className={styles.writeFields} aria-label="Prepare a write action">
          <label>Action<select className="input" value={action} onChange={(e) => { setAction(e.target.value as WriteInput["action"]); setAccount("default"); }}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Write account<select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>{provider?.accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.id})</option>)}</select></label>
          <div key={action} className={styles.writeFields}>
            {action === "issue.create" && <>{field("projectKey", "Project key", "PROJ")}{field("parentKey", "Parent ticket (optional)", "PROJ-123", false)}{field("sprintId", "Sprint ID (optional)", "123", false)}<label className={styles.check}><input type="checkbox" name="assignToMe" defaultChecked />Assign to the connected Jira user</label></>}
            {action === "pr.create" && <>{field("repo", "Repository", "owner/repository")}<div className={styles.row}>{field("head", "Head branch", "feature/my-change")}{field("base", "Base branch", "main")}</div><label className={styles.check}><input type="checkbox" name="draft" defaultChecked />Create as a draft</label><p className={styles.meta}>Branches must already exist on GitHub. Creating a PR does not push local commits.</p></>}
            {["issue.transition", "pr.update", "pr.publish"].includes(action) && field("id", providerId === "jira" ? "Ticket key" : "Pull request", providerId === "jira" ? "PROJ-123" : "owner/repository/123")}
            {action === "issue.transition" && <>{field("transitionId", "Native transition ID", "31")}<p className={styles.meta}>Find the ticket above and choose Show native transitions. The review shows its current state and destination state.</p></>}
            {["issue.create", "pr.create", "pr.update"].includes(action) && <>{field("title", "Title")}<label>Description<textarea className="input" name="body" rows={6} required={action === "issue.create"} maxLength={action === "issue.create" ? 5000 : 20000} /></label></>}
          </div>
          <div><button className="btn btn-primary" disabled={busy || !provider?.capabilities.includes(action)}>{busy ? "Preparing action…" : "Review action…"}</button></div>
        </fieldset>
      </form>
      <h3>Recent actions</h3>
      {error ? <FetchError message={error.message} onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={3} /> : !data.proposals.length ? <p>No actions yet. Prepare one above or send an allowlisted chat command.</p> : <ul className={styles.list}>{data.proposals.map((p) => {
        const awaiting = ["requested", "pending"].includes(p.state); const expired = Date.parse(p.expiresAt) <= data.now;
        return <li key={p.id}><div className={styles.item}><div><strong>{p.prepared?.summary ?? labels[p.input.action]}</strong><p className={styles.meta}>{p.input.provider} · {p.input.account} · {awaiting && expired ? "Expired" : p.state === "unknown" ? "Outcome unknown" : p.state} · {p.source === "DevHub" ? "DevHub" : "Chat request"}</p><p>{p.detail || (awaiting && !expired ? "Nothing has been sent. Review and confirm to continue." : awaiting ? "Create a new action to review it again." : "")}</p></div><div className={styles.actions}>{awaiting && !expired && <button className="btn btn-ghost" disabled={busy} onClick={() => void act(() => openWriteReview(p))}>Review action</button>}{awaiting && <button className="btn btn-ghost" disabled={busy} onClick={() => void act(() => writeRequest({ action: "cancel", id: p.id }))}>Cancel</button>}{p.receipt?.item?.url?.startsWith("https://") && <a href={p.receipt.item.url} target="_blank" rel="noopener noreferrer">Open result</a>}</div></div></li>;
      })}</ul>}
    </section>
    <section id="chat" className={styles.section}><h2>Inbound chat commands</h2><p>Slack first, then Telegram private bot chats. Only configured senders and conversations can request actions for this work profile. Chat cannot confirm writes.</p>
      {error ? <FetchError message="Could not load chat configuration." onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={2} /> : <ul className={styles.list}>{data.chat.map((c) => <li key={c.provider}><strong>{c.provider === "slack" ? "Slack" : "Telegram"}</strong>{c.provider === "telegram" && <p className={styles.meta}><Link className={styles.helpLink} href="/docs/guides/integrations#telegram-setup">How to set up Telegram</Link> · Webhook commands need a secret and an exact private sender/chat allowlist, separate from alerts.</p>}<p>{!c.enabled ? "Disabled. Configure the webhook secret and allowlist to opt in." : !c.configured ? "Configuration needs attention. Check the secret and allowlist on the server." : c.allowed ? "Enabled for " + c.allowed + " allowlisted sender/conversation pairs in this profile." : "No senders are allowed in this work profile."}</p></li>)}</ul>}
      <p>Use <code>/devhub help</code>, <code>/devhub status</code> or <code>/devhub propose</code> with action JSON. Requests expire after 15 minutes and appear in Recent actions for review.</p>
      <Link href="/docs/guides/integrations">Chat setup and command examples</Link>
      <p className={styles.meta}>Webhook setup needs an HTTPS route to the two chat endpoints. Keep the rest of DevHub behind authentication. WhatsApp remains parked: it requires the paid Business API.</p>
    </section>
  </>;
}
