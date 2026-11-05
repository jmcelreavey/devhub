"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X, Check } from "lucide-react";
import { useRouter } from "@/lib/navigation";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useToast } from "@/lib/hooks/use-toast";
import { HoverTip } from "@/components/ui/HoverTip";
import { openInBrowser } from "@/lib/desktop/bridge";
import {
  NOTIFICATION_SOURCE_KEYS,
  NOTIFICATION_SOURCE_TOGGLE_LABELS,
  type Notification,
  type NotificationSourcePrefs,
} from "@shared/notifications/types";

const SOURCE_LABELS = { github: "Pull request", ci: "CI", agent: "Agent", datadog: "Datadog", plugin: "Plugin", "plugin-trust": "Plugin trust" } as const;
const MAX_ROWS = 30;

/**
 * The bell is the notifications surface: badge, count, a popover to act on
 * what matters, and the toggles for what surfaces at all. There is no inbox
 * page — this is it, by design.
 */
export function NotificationBell() {
  const feed = useNotifications();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const data = feed.data;

  useEffect(() => {
    if (!open) return;
    const first = ref.current?.querySelector<HTMLButtonElement>("[data-mark-all]");
    first?.focus();
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".hub-icon-btn")?.focus(); }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const update = async (body: Parameters<typeof feed.update>[0]) => {
    setSaving(true);
    try { await feed.update(body); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't update notifications."); }
    finally { setSaving(false); }
  };

  const unread = data?.unread ?? 0;
  const urgent = (data?.items ?? []).some(item => item.severity === "urgent" && !item.read && !item.dismissed);
  const items = (data?.items ?? [])
    .filter(item => !item.dismissed)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ROWS);
  const unreadIds = items.filter(item => !item.read).map(item => item.id);
  const degraded = Object.entries(data?.sources ?? {}).filter(([, status]) => status === "degraded").length;

  const openItem = (item: Notification) => {
    setOpen(false);
    if (!item.read) void update({ ids: [item.id], action: "read" });
    if (item.link.startsWith("/")) router.push(item.link);
    else void openInBrowser(item.link);
  };

  const toggleOwned = () => void update({ ownedReposOnly: !(data?.ownedReposOnly ?? false) });
  const toggleSource = (key: keyof NotificationSourcePrefs) => {
    if (!data) return;
    void update({ sources: { [key]: !data.sourcePrefs[key] } });
  };

  return (
    <div ref={ref} className="notification-bell">
      <HoverTip label={open ? false : unread ? `Notifications (${unread} unread)` : "Notifications"} pos="bottom-end">
        <button
          type="button"
          className="hub-icon-btn notification-bell-btn"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          onClick={() => setOpen(v => !v)}
        >
          <Bell size={14} aria-hidden />
          {unread > 0 && <span className="notification-bell-badge" data-urgent={urgent || undefined}>{unread > 99 ? "99+" : unread}</span>}
        </button>
      </HoverTip>
      {open && (
        <div className="notification-bell-pop" role="dialog" aria-label="Notifications">
          <div className="notification-bell-header">
            <strong>Notifications</strong>
            <button type="button" className="btn btn-ghost notification-bell-markall" data-mark-all disabled={saving || unreadIds.length === 0} onClick={() => void update({ ids: unreadIds, action: "read" })}>
              <Check size={12} aria-hidden /> Mark all seen
            </button>
          </div>
          {degraded > 0 && <p className="notification-bell-degraded" role="status">Some updates may be out of date. <button className="btn btn-ghost" onClick={feed.retry}>Retry</button></p>}
          {feed.error && <p className="notification-bell-degraded" role="alert">{feed.error.message}</p>}
          {!feed.data && !feed.error ? <p className="notification-bell-empty">Loading…</p> : null}
          {feed.data && items.length === 0 && <p className="notification-bell-empty" role="status">You&apos;re all caught up.</p>}
          {items.length > 0 && (
            <ul className="notification-bell-list">
              {items.map(item => (
                <li key={item.id} className="notification-bell-row" data-unread={!item.read || undefined}>
                  <span className="notification-bell-dot" data-severity={item.severity} aria-hidden />
                  <button type="button" className="notification-bell-title" onClick={() => openItem(item)}>
                    <span className="notification-bell-title-text">{item.title}</span>
                    <span className="notification-bell-reason">{item.reason}{item.repo ? <> · <span className="notification-bell-repo">{item.repo}</span></> : null}</span>
                  </button>
                  <span className="notification-bell-source">{SOURCE_LABELS[item.source]}</span>
                  <button type="button" className="hub-icon-btn notification-bell-dismiss" aria-label={`Dismiss: ${item.title}`} title="Dismiss" disabled={saving} onClick={() => void update({ ids: [item.id], action: "dismiss" })}>
                    <X size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="notification-bell-toggles" role="group" aria-label="Show">
            <span className="notification-bell-toggles-label">Show</span>
            {NOTIFICATION_SOURCE_KEYS.map(key => (
              <label key={key} className="notification-bell-toggle">
                <input type="checkbox" checked={data?.sourcePrefs[key] ?? true} disabled={!data || saving} onChange={() => toggleSource(key)} />
                {NOTIFICATION_SOURCE_TOGGLE_LABELS[key]}
              </label>
            ))}
            <label className="notification-bell-toggle">
              <input type="checkbox" checked={data?.ownedReposOnly ?? false} disabled={!data || saving} onChange={toggleOwned} />
              Only PRs I own
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
