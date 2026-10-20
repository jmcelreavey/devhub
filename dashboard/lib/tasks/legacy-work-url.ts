export function legacyWorkUrl(search: string, tab: "tasks" | "jira", hash = ""): string {
  const params = new URLSearchParams(search);
  if (!params.has("tab")) params.set("tab", tab);
  return `/work?${params}${hash}`;
}
