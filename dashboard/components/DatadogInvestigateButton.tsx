"use client";

import { openAgentHandoff } from "@/lib/agent-handoff";
import type { RecentEvent } from "@/lib/datadog/recent-events";
import { useToast } from "@/lib/hooks/use-toast";
import { ScanSearch } from "lucide-react";
import { useState } from "react";

interface DatadogInvestigateButtonProps {
  scope: "oncall" | "team" | "general";
  alert?: RecentEvent;
  label?: string;
  compact?: boolean;
}

export function DatadogInvestigateButton({ scope, alert, label, compact }: DatadogInvestigateButtonProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const locationAtStart = window.location.href;
    try {
      const res = await fetch("/api/datadog/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prepare: true,
          scope,
          title: alert?.title,
          status: alert?.status,
          tags: alert?.tags,
          timestampMs: alert?.timestampMs,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sessionId?: string;
        runId?: string;
        providerLabel?: string;
        prompt?: string; title?: string; cwd?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "Investigation failed");
      if (window.location.href === locationAtStart) openAgentHandoff({ title: json.title || "Investigate", prompt: json.prompt, cwd: json.cwd, worktree: false });
      setBusy(false);
    } catch (e) {
      console.error("datadog investigate:", e);
      toast.error(e instanceof Error ? e.message : "Couldn't start investigation.");
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void run();
      }}
      disabled={busy}
      className={compact ? "hub-icon-btn" : "btn btn-ghost text-xs"}
      style={compact ? undefined : { padding: "3px 8px" }}
      title="Investigate with agent"
      aria-label={`Investigate ${alert?.title ?? scope} with agent`}
    >
      <ScanSearch size={compact ? 11 : 12} aria-hidden />
      {!compact && <span className="ml-1">{busy ? "Starting…" : (label ?? "Investigate")}</span>}
    </button>
  );
}
