export interface RepoRemovalFailure {
  name: string;
  message: string;
}

export async function removeLocalRepos(
  names: readonly string[],
  onProgress: (name: string) => void,
): Promise<{ removed: string[]; failed: RepoRemovalFailure[] }> {
  const removed: string[] = [];
  const failed: RepoRemovalFailure[] = [];
  for (const name of new Set(names)) {
    onProgress(name);
    try {
      const response = await fetch(`/api/repos/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : `Request failed (${response.status})`;
        failed.push({ name, message });
        continue;
      }
      removed.push(name);
    } catch (error) {
      console.error("remove local repo:", name, error);
      failed.push({ name, message: "Could not confirm deletion. Refresh before retrying." });
    }
  }
  return { removed, failed };
}
