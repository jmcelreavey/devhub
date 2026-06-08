"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { requestOpenCodeSession } from "@/lib/opencode-session";
import type { RecentEvent } from "@/lib/datadog-recent-events";

interface DatadogInvestigateButtonProps {
  scope: "oncall" | "team" | "general";
  alert?: RecentEvent;
  label?: string;
  compact?: boolean;
}

export function DatadogInvestigateButton({ scope, alert, label, compact }: DatadogInvestigateButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/datadog/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "Investigation failed");
      // Steer the persistent OpenCode iframe to the session we just created so
      // the user lands on it (the iframe is cross-origin; we can only set src).
      if (json.sessionId) requestOpenCodeSession(json.sessionId);
      toast.success("Investigation started in OpenCode.");
      router.push("/opencode");
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
      title="Investigate in OpenCode"
      aria-label={`Investigate ${alert?.title ?? scope} in OpenCode`}
    >
      <Sparkles size={compact ? 11 : 12} aria-hidden />
      {!compact && <span className="ml-1">{busy ? "Starting…" : (label ?? "Investigate")}</span>}
    </button>
  );
}
