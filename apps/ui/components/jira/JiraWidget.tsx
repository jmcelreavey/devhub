import type { SeverityTone } from "@/components/ui/Severity";

export function statusTone(status: string): SeverityTone {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("merged")) return "success";
  if (s.includes("block")) return "critical";
  if (s.includes("qa")) return "brand";
  if (s.includes("progress") || s.includes("dev")) return "info";
  if (s.includes("review") || s.includes("change")) return "warning";
  if (s.includes("todo") || s.includes("backlog") || s.includes("to do") || s.includes("open")) return "muted";
  return "muted";
}

/** @deprecated Use statusTone + SeverityDot/SeverityPill instead. */
export function statusColor(status: string): string {
  const t = statusTone(status);
  const map: Record<SeverityTone, string> = {
    success: "var(--success)", critical: "var(--danger)", violet: "var(--info)",
    info: "var(--info)", warning: "var(--warning)", muted: "var(--text-subtle)", brand: "var(--accent)",
  };
  return map[t];
}

export function priorityIcon(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes("highest")) return "🔴";
  if (p.includes("high")) return "🟠";
  if (p.includes("medium")) return "🟡";
  if (p.includes("low")) return "🔵";
  if (p.includes("lowest")) return "⚪";
  return "⚪";
}
