"use client";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import type { IntegrationItem, IntegrationRef, IntegrationPage } from "@/lib/integrations/types";
import type { SavedAccount } from "@/lib/integrations/accounts";
import Alerts from "./Alerts";
import Writes from "./Writes";
import styles from "./integrations.module.css";

interface Provider { id: string; label: string; capabilities: string[]; accounts: { id: string; label: string }[] }
interface Data { providers: Provider[]; accounts: SavedAccount[]; task: { id: string; text: string; refs: IntegrationRef[]; addedRefs: IntegrationRef[]; revision: string } | null }
import { postIntegration } from "./request";
export default function IntegrationsClient() {
  const taskId = useSearchParams().get("taskId");
  const { data, error, mutate } = useLive<Data>("/api/integrations" + (taskId ? "?taskId=" + encodeURIComponent(taskId) : ""));
  const [providerId, setProvider] = useState("jira"); const [account, setAccount] = useState("default");
  const [kind, setKind] = useState<"issue" | "pr">("issue"); const [query, setQuery] = useState("");
  const [page, setPage] = useState<IntegrationPage | null>(null); const [detail, setDetail] = useState<IntegrationItem | null>(null);
  const [checkNext, setCheckNext] = useState<string>();
  const [extra, setExtra] = useState(""); const [busy, setBusy] = useState(""); const pending = useRef(false);
  const [failure, setFailure] = useState(""); const [message, setMessage] = useState("");
  const [newProvider, setNewProvider] = useState("github");
  async function act(name: string, work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(name); setFailure(""); setMessage("");
    try { await work(); } catch (e) { setFailure(e instanceof Error ? e.message : "Request failed."); }
    finally { pending.current = false; setBusy(""); }
  }
  if (error) return <div className="page-wrapper"><FetchError message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data) return <div className="page-wrapper"><SkeletonRows count={4} /></div>;
  const provider = data.providers.find((p) => p.id === providerId);
  const search = async (cursor?: string) => { const result = await postIntegration({ action: "search", provider: providerId, account, kind, query, cursor }); setPage(result); setDetail(null); };
  const checks = async (ref: IntegrationRef, cursor?: string) => {
    const result: IntegrationPage = await postIntegration({ action: "checks", ref, cursor });
    setExtra(result.items.map((i) => i.title + ": " + i.status?.label).join("\n") || "No check runs reported."); setCheckNext(result.next);
  };
  const link = async (ref: IntegrationRef, remove = false) => {
    if (!data.task) return;
    await postIntegration({ action: "link", ref, remove, taskId: data.task.id, revision: data.task.revision });
    await mutate(); setMessage(remove ? "Link removed. Legacy task links remain in the task editor." : "Linked to this task.");
  };
  return <div className={"page-wrapper " + styles.page}>
    <header className={styles.header}><h1>Integrations</h1><p>Find issues and pull requests across accounts. Choose which workflow updates can leave DevHub.</p>
      <nav aria-label="Integration sections"><a href="#connections">Connections</a><a href="#actions">Write actions</a><a href="#chat">Chat commands</a><a href="#alerts">Workflow alerts</a><Link href="/setup">Credential setup</Link>{data.task && <Link href={"/workflow?taskId=" + encodeURIComponent(data.task.id)}>Back to task workflow</Link>}</nav>
    </header>
    {failure && <p role="alert" className="tone-panel tone-panel--danger">{failure}</p>}
    {message && <p role="status" className="tone-panel tone-panel--muted">{message}</p>}
    {data.task && <section className={styles.section}><h2>Linked to {data.task.text}</h2>
      {data.task.refs.length ? <ul className={styles.list}>{data.task.refs.map((ref) => <li key={JSON.stringify(ref)}><div className={styles.item}><div><strong>{ref.id}</strong><p className={styles.meta}>{ref.provider} · {ref.account} · {ref.kind}</p></div><div className={styles.actions}><button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("load", async () => { setDetail(await postIntegration({ action: "get", ref })); setExtra(""); setCheckNext(undefined); })}>Inspect</button>{data.task?.addedRefs.some((saved) => JSON.stringify(saved) === JSON.stringify(ref)) && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("unlink", () => link(ref, true))}>Remove link</button>}</div></div></li>)}</ul> : <p>No integration links yet. Search below to attach an issue or PR.</p>}
      <p className={styles.meta}>Existing Jira keys and PR links stay in the task editor. Native statuses do not change task completion.</p>
    </section>}
    <section id="connections" className={styles.section}><h2>Find an issue or pull request</h2>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void act("search", () => search()); }}>
        <div className={styles.row}><label>Provider<select className="input" value={providerId} disabled={!!busy} onChange={(e) => { setProvider(e.target.value); setAccount(data.providers.find((p) => p.id === e.target.value)?.accounts[0]?.id ?? "default"); setKind("issue"); setPage(null); setDetail(null); }}>{data.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Account<select className="input" value={account} disabled={!!busy} onChange={(e) => { setAccount(e.target.value); setPage(null); }}>{provider?.accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.id})</option>)}</select></label></div>
        <label>Item type<select className="input" value={kind} disabled={!!busy} onChange={(e) => { setKind(e.target.value as "issue" | "pr"); setPage(null); }}><option value="issue">Issue</option>{provider?.capabilities.includes("pr.search") && <option value="pr">Pull request</option>}</select></label>
        <label>{providerId === "jira" ? "Jira query (JQL)" : "Provider search query"}<input className="input" disabled={!!busy} value={query} onChange={(e) => { setQuery(e.target.value); setPage(null); }} required maxLength={2000} placeholder={providerId === "jira" ? "assignee = currentUser() ORDER BY updated DESC" : "repo:owner/repository is:open"} /></label>
        <div><button className="btn btn-primary" disabled={!!busy || !provider?.capabilities.includes(kind + ".search")}>{busy === "search" ? "Searching…" : "Search"}</button></div>
      </form>
      {page && <><p role="status">{page.items.length ? page.items.length + " results on this page" : "No matching items. Try a broader query."}</p><ul className={styles.list}>{page.items.map((item) => <li key={JSON.stringify(item.ref)}><div className={styles.item}><div><strong>{item.title}</strong><p className={styles.meta}>{item.ref.id} · {item.status?.label || "Status unavailable"}{item.draft ? " · Draft" : ""}</p></div><div className={styles.actions}><button className="btn btn-ghost" disabled={!!busy} onClick={() => { setDetail(item); setExtra(""); setCheckNext(undefined); }}>Inspect</button>{data.task && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("link", () => link(item.ref))}>Link to task</button>}</div></div></li>)}</ul>{page.next && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("search", () => search(page.next))}>Next page</button>}</>}
      {detail && <div className="tone-panel tone-panel--muted"><h3>{detail.title}</h3><p>{detail.ref.provider} · {detail.ref.account} · {detail.ref.kind} · {detail.status?.label || "No status"}{detail.draft ? " · Draft" : ""}</p><div className={styles.actions}>
        {detail.url?.startsWith("https://") && <a href={detail.url} target="_blank" rel="noopener noreferrer">Open in provider</a>}
        {data.providers.find((p) => p.id === detail.ref.provider)?.capabilities.includes("issue.transitions") && detail.ref.kind === "issue" && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("transitions", async () => { const result = await postIntegration({ action: "transitions", ref: detail.ref }); setCheckNext(undefined); setExtra(result.items.map((i: { id: string; label: string }) => i.label + " (" + i.id + ")").join(", ") || "No available transitions."); })}>Show native transitions</button>}
        {detail.ref.kind === "pr" && data.providers.find((p) => p.id === detail.ref.provider)?.capabilities.includes("pr.checks") && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("checks", () => checks(detail.ref))}>Show check runs</button>}
      </div>{extra && <><p className={styles.preview}>{extra}</p>{checkNext && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("checks", () => checks(detail.ref, checkNext))}>Next check runs</button>}</>}<p className={styles.meta}>Use Write actions below to prepare a change. Each action needs a separate review and confirmation.</p></div>}
    </section>
    <section className={styles.section}><h2>Accounts</h2><p>Existing Jira setup and gh login work as before. Additional accounts use named server environment variables. Configure them locally and restart DevHub before adding an account; tokens are never stored here.</p>
      <ul className={styles.list}>{data.accounts.map((a) => <li key={a.provider + a.id}><div className={styles.item}><div><strong>{a.label}</strong><p className={styles.meta}>{a.provider} · {a.id} · {a.tokenRef}</p></div><button className="btn btn-ghost" disabled={!!busy} onClick={() => void act("account", async () => { await postIntegration({ action: "account", account: a, remove: true }); await mutate(); })}>Remove account</button></div></li>)}</ul>
      <details><summary>Add an account</summary><form className={styles.form} onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form)); void act("account", async () => { await postIntegration({ action: "account", account: values }); await mutate(); form.reset(); setMessage("Account saved. Search to check access."); }); }}>
        <label>Provider<select className="input" name="provider" value={newProvider} onChange={(e) => setNewProvider(e.target.value)}><option value="github">GitHub</option><option value="jira">Jira Cloud</option></select></label>
        <div className={styles.row}><label>Account ID<input className="input" name="id" required pattern="[a-zA-Z0-9_-]+" maxLength={64} placeholder="work" /></label><label>Display name<input className="input" name="label" required maxLength={80} /></label></div>
        <label>Token variable name<input className="input" name="tokenRef" required pattern="[A-Z][A-Z0-9_]+" placeholder="WORK_GITHUB_TOKEN" maxLength={128} /></label>
        {newProvider === "jira" && <><label>Cloud domain<input className="input" name="domain" required placeholder="team.atlassian.net" /></label><label>Email variable name<input className="input" name="emailRef" required pattern="[A-Z][A-Z0-9_]+" placeholder="WORK_JIRA_EMAIL" /></label></>}
        <div><button className="btn btn-primary" disabled={!!busy}>{busy === "account" ? "Saving…" : "Save account"}</button></div>
      </form></details>
    </section>
    <Writes providers={data.providers} />
    <Alerts />
  </div>;
}
