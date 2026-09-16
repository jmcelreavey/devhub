"use client";

import { useState } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";

const KEY = "/api/tasks/alert-drafts";

/** Opt-in: new on-call alerts become draft tasks (never dispatched). */
export function AlertDraftsToggle() {
  const toast = useToast();
  const { data, mutate } = useLive<{ enabled: boolean }>(KEY, { refreshInterval: 0 });
  const [saving, setSaving] = useState(false);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      await mutate(
        async () => {
          const res = await fetch(KEY, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled }),
          });
          if (!res.ok) throw new Error("Couldn't save");
          return (await res.json()) as { enabled: boolean };
        },
        { optimisticData: { enabled }, rollbackOnError: true, revalidate: false },
      );
      if (enabled) toast.success("New on-call alerts will become draft tasks");
    } catch {
      toast.error("Couldn't save the alert-draft setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <label
      className="flex items-center gap-1.5 text-[11px] text-text-muted"
      title="Each new firing on-call alert becomes a draft task with related context. Nothing is dispatched."
    >
      <input
        type="checkbox"
        checked={data?.enabled ?? false}
        disabled={!data || saving}
        onChange={(e) => void toggle(e.target.checked)}
      />
      Draft a task for new alerts
    </label>
  );
}
