"use client";
import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useLive } from "@/lib/hooks/use-fetch";
import { profileKey, profileHeaders } from "@shared/tasks/profile-scope";
import type { NotificationsFeed } from "@shared/notifications/types";

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
  const { mutate } = useSWRConfig();
  const update = async (body: { ids: string[]; action: "read" | "dismiss" | "restore" } | { ownedReposOnly: boolean }) => {
    if (!identity.profile) throw new Error("Confirm the active profile before changing notifications.");
    const response = await fetch(profileKey("/api/notifications", identity.profile)!, { method: "ownedReposOnly" in body ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...profileHeaders(identity.profile) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Couldn't update notifications. Please try again.");
    await mutate(key => typeof key === "string" && key.startsWith("/api/notifications"));
  };
  return { ...result, data: identity.profile ? result.data : undefined, error: identity.error ?? result.error, retry: identity.error ? identity.retry : () => { void result.mutate(); }, update };
}
