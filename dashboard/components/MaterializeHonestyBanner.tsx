"use client";

import { AlertTriangle } from "lucide-react";
import { useLive } from "@/lib/use-fetch";

interface MaterializeHonestyReport {
  ok: boolean;
  checked: number;
  drifts: { path: string; plugin: string; reason: string }[];
  message: string | null;
}

/** Screams when plugin-owned materialised copies diverge from plugin source. */
export function MaterializeHonestyBanner() {
  const { data } = useLive<MaterializeHonestyReport>("/api/status/materialized", {
    refreshInterval: 60_000,
  });

  if (!data || data.ok || !data.message) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "var(--warning, #c9a227)",
        background: "color-mix(in srgb, var(--warning, #c9a227) 12%, transparent)",
        color: "var(--text)",
      }}
    >
      <div className="mb-1 flex items-center gap-2 font-semibold" style={{ color: "var(--warning, #c9a227)" }}>
        <AlertTriangle size={14} aria-hidden />
        Plugin-owned files edited in core
      </div>
      <p style={{ color: "var(--text-subtle)" }}>{data.message}</p>
      <ul className="mt-2 space-y-0.5 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
        {data.drifts.slice(0, 8).map((d) => (
          <li key={d.path}>
            {d.path} <span style={{ opacity: 0.7 }}>({d.plugin} · {d.reason})</span>
          </li>
        ))}
      </ul>
      <p className="mt-2" style={{ color: "var(--text-subtle)" }}>
        Edit under the plugin repo (e.g. <code>~/Developer/devhub-bi/</code>), then re-run{" "}
        <code>sync_plugins</code>. See AGENTS.md → Plugin Architecture.
      </p>
    </div>
  );
}
