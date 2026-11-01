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

/** Accept a GitHub PR URL or an EntityRef id (`owner/repo#123`). */
export function parseGithubPrRef(raw: string): { repo: string; number: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromUrl = parseGithubPrUrl(trimmed);
  if (fromUrl) return fromUrl;
  const hash = trimmed.match(/^([\w.-]+\/[\w.-]+)#([1-9]\d*)$/);
  if (hash) return parseGithubPrUrl(`https://github.com/${hash[1]}/pull/${hash[2]}`);
  return parseGithubPrUrl(`https://github.com/${trimmed.replace("#", "/pull/")}`);
}
