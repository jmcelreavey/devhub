export function isGithubPrsListKey(key: unknown): key is string {
  return typeof key === "string" && (key === "/api/github/prs" || key.startsWith("/api/github/prs?"));
}
