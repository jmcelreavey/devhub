"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import Link from "@/lib/navigation";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useToast } from "@/lib/hooks/use-toast";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import type { Severity } from "@shared/notifications/types";

const sections: { severity: Severity; label: string }[] = [{ severity: "urgent", label: "Urgent" }, { severity: "action", label: "Needs you" }, { severity: "info", label: "Updates" }];
export default function NotificationsPage() {
  const feed = useNotifications(), toast = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = async (body: Parameters<typeof feed.update>[0]) => {
    setSaving(true);
    try { await feed.update(body); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't update notifications."); }
    finally { setSaving(false); }
  };
  const items = feed.data?.items.filter(item => item.dismissed === dismissed) ?? [];
  const degraded = Object.entries(feed.data?.sources ?? {}).filter(([, status]) => status === "degraded").map(([name]) => name === "github" ? "GitHub" : name === "ci" ? "CI" : name === "datadog" ? "Datadog" : name === "plugin-trust" ? "Plugin trust" : name === "agent" ? "Agents" : "Plugins");
  return <div className="page-wrapper max-w-4xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-xl font-semibold"><Bell size={20} aria-hidden /> Notifications</h1><p className="mt-1 text-sm text-text-muted">{feed.data ? `${feed.data.unread} unread` : "Updates that need your attention"}</p></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={feed.data?.ownedReposOnly ?? false} disabled={!feed.data || saving} onChange={event => void update({ ownedReposOnly: event.target.checked })} /> Only repos I own</label>
    </header>
    <div className="flex flex-wrap gap-2">
      <button className={`btn ${!dismissed ? "btn-primary" : "btn-ghost"}`} aria-pressed={!dismissed} onClick={() => setDismissed(false)}>Inbox</button>
      <button className={`btn ${dismissed ? "btn-primary" : "btn-ghost"}`} aria-pressed={dismissed} onClick={() => setDismissed(true)}>Dismissed</button>
    </div>
    {feed.error ? <FetchError message="Couldn't load notifications." onRetry={feed.retry} /> : !feed.data ? <SkeletonRows count={4} height={64} /> : <>
      {degraded.length > 0 && <p className="tone-panel tone-panel--warning-banner" role="status">Unavailable: {degraded.join(", ")}. Other updates are shown. <button className="btn btn-ghost" onClick={feed.retry}>Retry</button></p>}
      {!items.length && <p className="text-sm text-text-muted">{dismissed ? "No dismissed notifications." : degraded.length ? "No notifications from the available sources." : "You're all caught up."}</p>}
      {sections.map(({ severity, label }) => {
        const rows = items.filter(item => item.severity === severity).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!rows.length) return null;
        return <section key={severity} className="card" aria-label={label}>
          <h2 className="card-header">{label} <span className="badge badge-muted">{rows.length}</span></h2>
          <ul className="divide-y divide-border-muted">{rows.map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1"><Link href={item.link} className={`break-words text-sm hover:underline ${item.read ? "text-text-muted" : "font-semibold"}`}>{item.title}</Link>{!item.read && !dismissed && <span className="badge badge-accent ml-2">Unread</span>}
              <p className="mt-1 text-xs text-text-muted">{[item.reason, item.repo].filter(Boolean).join(" · ")}</p></div>
            <div className="flex gap-2">{dismissed ? <button className="btn btn-ghost" disabled={saving} onClick={() => void update({ ids: [item.id], action: "restore" })}>Restore</button> : <>
              {!item.read && <button className="btn btn-ghost" disabled={saving} onClick={() => void update({ ids: [item.id], action: "read" })}>Mark read</button>}
              <button className="btn btn-ghost" disabled={saving} onClick={() => void update({ ids: [item.id], action: "dismiss" })}>Dismiss</button>
            </>}</div>
          </li>)}</ul>
        </section>;
      })}
    </>}
  </div>;
}
