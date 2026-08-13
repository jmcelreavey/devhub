export type StatusTone = "ok" | "bad" | "unknown";

export function statusTone(value: "passing" | "pending" | "failing" | "unknown"): StatusTone {
  return value === "passing" ? "ok" : value === "unknown" ? "unknown" : "bad";
}
