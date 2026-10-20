"use client";

import { useEffect } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { notify, notifyPermission } from "@/lib/desktop/bridge";
import type { WorkflowInboxResponse } from "@/lib/workflows/inbox";

/** Delivery markers survive reloads; notification bodies never contain task text. */
export function WorkflowNotifications() {
  const { data } = useLive<WorkflowInboxResponse>("/api/tasks/workflow", { refreshInterval: 15000 });
  useEffect(() => {
    if (!data) return;
    let disposed = false;
    void (async () => {
      if (await notifyPermission() !== "granted" || disposed) return;
      const pending = data.items.filter(({ workflow }) => ["waiting-user", "blocked"].includes(workflow.status) && workflow.seenRevision < workflow.revision);
      const unseen = pending.filter(({ workflow }) => {
        try { return Number(localStorage.getItem("devhub:workflow-alert:" + workflow.taskId) ?? 0) < workflow.revision; }
        catch { return false; }
      });
      if (!unseen.length) return;
      for (const { workflow } of unseen) localStorage.setItem("devhub:workflow-alert:" + workflow.taskId, String(workflow.revision));
      await notify("DevHub needs you", unseen.length === 1 ? "A task has an update. Open the Storyboard inbox to review it." : unseen.length + " tasks have updates. Open the Storyboard inbox to review them.");
    })().catch((error: unknown) => console.error("[workflow] Notification delivery failed", error));
    return () => { disposed = true; };
  }, [data]);
  return null;
}
