export interface RepoLinkTarget {
  repoName: string;
  path?: string;
  line?: number;
}

export function parseRepoLinkHref(href: string): RepoLinkTarget | null {
  const trimmed = href.trim();
  const raw = trimmed.startsWith("repo://") ? trimmed.slice("repo://".length) : trimmed.startsWith("repo:") ? trimmed.slice("repo:".length) : null;
  if (!raw) return null;

  const [withoutHash, hash] = raw.split("#", 2);
  const [repoName, ...pathParts] = withoutHash.split("/").filter(Boolean);
  if (!repoName || repoName.includes("..") || !/^[a-zA-Z0-9_.-]+$/.test(repoName)) return null;
  if (pathParts.some((part) => part === ".." || part.includes(".."))) return null;

  const lineMatch = hash?.match(/^L(\d+)$/i);
  const line = lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined;
  const path = pathParts.length ? pathParts.join("/") : undefined;
  return { repoName, path, line };
}

export function isRepoLinkHref(href: string): boolean {
  return parseRepoLinkHref(href) !== null;
}

export async function openRepoLinkHref(href: string): Promise<void> {
  const target = parseRepoLinkHref(href);
  if (!target) throw new Error("Invalid repo link.");
  const res = await fetch(`/api/repos/${encodeURIComponent(target.repoName)}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: target.path, line: target.line }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not open repo.");
  }
}
