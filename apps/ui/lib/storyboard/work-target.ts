export type WorkTab = "tasks" | "board" | "reviews" | "jira" | "history" | "review" | "rep";

function parseWorkTab(raw: string | null, fallback: WorkTab): WorkTab {
  if (raw === "jira" || raw === "tickets") return "jira";
  if (raw === "tasks" || raw === "board" || raw === "reviews" || raw === "history" || raw === "review" || raw === "rep") return raw;
  return fallback;
}

export function resolveWorkTab(params: Pick<URLSearchParams, "get">, initialTab: WorkTab): WorkTab {
  const date = params.get("date");
  const ticket = params.get("ticket");
  const requestedTab = params.get("tab");
  const fallbackTab = date !== null ? "history" : ticket !== null ? "jira" : initialTab;
  return date !== null && (requestedTab === null || requestedTab === "tasks")
    ? "history" : parseWorkTab(requestedTab, fallbackTab);
}

export function validWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
