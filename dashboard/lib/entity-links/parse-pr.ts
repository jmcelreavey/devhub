/** Client-safe PR URL parse (no node:fs). */
export function parseGithubPrUrl(url: string): { repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}
