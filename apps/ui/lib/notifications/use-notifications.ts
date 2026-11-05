"use client";
import { useCallback, useEffect, useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { profileKey, profileHeaders } from "@shared/tasks/profile-scope";
import type { NotificationsFeed, NotificationSourcePrefs } from "@shared/notifications/types";

export function useNotificationProfile() {
  const identity = useLive<{ active: string }>("/api/tasks/profiles?identity=1", { revalidateOnMount: true, keepPreviousData: false });
  const { mutate } = identity;
  const [switching, setSwitching] = useState(false);
  const retry = useCallback(() => {
    setSwitching(true);
    void mutate().finally(() => setSwitching(false)).catch(() => undefined);
  }, [mutate]);
  useEffect(() => {
    const start = () => { setSwitching(true); void mutate(undefined, { revalidate: false }); };
    window.addEventListener("devhub:task-profile-changing", start);
    window.addEventListener("devhub:task-profile-changed", retry);
    return () => { window.removeEventListener("devhub:task-profile-changing", start); window.removeEventListener("devhub:task-profile-changed", retry); };
  }, [mutate, retry]);
  return { profile: !switching && !identity.error ? identity.data?.active : undefined, error: identity.error, retry };
}

export function useNotifications() {
  const identity = useNotificationProfile();
  const result = useLive<NotificationsFeed>(profileKey("/api/notifications", identity.profile), { refreshInterval: 60_000, keepPreviousData: false });
  const update = async (body: { ids: string[]; action: "read" | "dismiss" | "restore" } | { ownedReposOnly: boolean } | { sources: Partial<NotificationSourcePrefs> }) => {
    if (!identity.profile) throw new Error("Confirm the active profile before changing notifications.");
    const key = profileKey("/api/notifications", identity.profile)!;
    const headers = { "Content-Type": "application/json", ...profileHeaders(identity.profile) };
    if ("ownedReposOnly" in body || "sources" in body) {
      const response = await fetch(key, { method: "PUT", headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Couldn't update notifications. Please try again.");
      await result.mutate();
      return;
    }
    const snapshot = result.data;
    if (!snapshot) throw new Error("Wait for notifications to load before changing them.");
    const versions = snapshot.items.filter(item => body.ids.includes(item.id)).map(({ id, version }) => ({ id, version }));
    const apply = (feed: NotificationsFeed = snapshot) => {
      const items = feed.items.map(item => versions.some(version => version.id === item.id && version.version === item.version)
        ? { ...item, read: body.action === "read" || item.read, dismissed: body.action === "dismiss" || (body.action !== "restore" && item.dismissed) } : item);
      return { ...feed, items, unread: items.filter(item => !item.read && !item.dismissed).length, urgent: items.filter(item => item.severity === "urgent" && !item.dismissed).length };
    };
    await result.mutate(async current => {
      const response = await fetch(key, { method: "POST", headers, body: JSON.stringify({ ...body, versions }) });
      if (!response.ok) throw new Error("Couldn't update notifications. Please try again.");
      return apply(current);
    }, { optimisticData: apply, rollbackOnError: true, revalidate: false });
  };
  return { ...result, data: identity.profile ? result.data : undefined, error: identity.error ?? result.error, retry: identity.error ? identity.retry : () => { void result.mutate(); }, update };
}
