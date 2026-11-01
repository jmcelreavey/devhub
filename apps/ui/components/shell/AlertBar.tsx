"use client";
import { useState } from "react";
import { BellRing, X } from "lucide-react";
import Link from "@/lib/navigation";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useToast } from "@/lib/hooks/use-toast";

export function AlertBar() {
  const feed = useNotifications(), toast = useToast();
  const [saving, setSaving] = useState(false);
  const items = feed.data?.items.filter(item => item.severity === "urgent" && !item.dismissed) ?? [];
  const first = items[0];
  if (!first || feed.error) return null;
  const dismiss = async () => {
    setSaving(true);
    try { await feed.update({ ids: [first.id], action: "dismiss" }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't dismiss this alert."); }
    finally { setSaving(false); }
  };
  return <aside className="notification-alert-bar" aria-label="Urgent notifications">
    <BellRing size={16} aria-hidden className="shrink-0" />
    <span className="notification-alert-title" role="status">{first.title}</span>
    <span className="ml-auto flex items-center gap-2">
      <Link href={first.link} className="btn btn-ghost shrink-0" aria-label={`Open ${first.title}`}>Open</Link>
      {items.length > 1 && <Link href="/notifications" className="shrink-0 underline">+{items.length - 1} more</Link>}
      <button className="btn btn-ghost shrink-0" aria-label={`Dismiss ${first.title}`} disabled={saving} onClick={() => void dismiss()}><X size={16} aria-hidden /></button>
    </span>
  </aside>;
}
