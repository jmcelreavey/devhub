"use client";

const SAVE_STATUS_CONFIG = {
  saving: { label: "Saving…", color: "var(--warning)" },
  saved: { label: "Saved", color: "var(--success)" },
  error: { label: "Error saving", color: "var(--danger)" },
} as const;

export function SaveStatusPill({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const { label, color } = SAVE_STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 overflow-hidden rounded text-xs"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
        paddingInline: "6px",
        paddingBlock: "2px",
      }}
    >
      {label}
    </span>
  );
}
