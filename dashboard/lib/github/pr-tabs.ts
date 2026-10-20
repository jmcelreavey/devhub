export type PrTab = "attention" | "authored" | "owned" | "reviews" | "recent" | "skipped" | "cleanup";

export function prTabFromSearch(value: string | null): PrTab {
  return value === "authored" || value === "owned" || value === "reviews" || value === "recent" || value === "skipped" || value === "cleanup" ? value : "attention";
}
