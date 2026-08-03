/** Client-safe PR URL parse (no node:fs). */
export function parseGithubPrUrl(url: string): { repo: string; number: number } | null {
  try {
    const parsed = new URL(url);
    const [owner, repo, pull, rawNumber] = parsed.pathname.split("/").filter(Boolean);
    const number = Number(rawNumber);

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.hostname.toLowerCase() !== "github.com" ||
      pull !== "pull" ||
      !owner ||
      !repo ||
      !/^[\w.-]+$/.test(owner) ||
      !/^[\w.-]+$/.test(repo) ||
      !/^[1-9]\d*$/.test(rawNumber || "") ||
      !Number.isSafeInteger(number)
    ) {
      return null;
    }

    return { repo: `${owner}/${repo}`, number };
  } catch {
    return null;
  }
}
