"use client";

import { copyTextToClipboard } from "@/lib/clipboard";
import { errorMessageFromBody, fetchGitJson, repoApi } from "./shared";

interface OneTimeShareResponse {
  share?: { url: string };
  passphrase?: string;
}

/**
 * Publish markdown (a git patch, a range diff) as a 24h burn-after-reading
 * PrivateBin link. Uses the existing one-time share API — no second crypto path.
 */
export async function shareGitPatchMarkdown(
  title: string,
  markdown: string,
): Promise<{ url: string; passphrase: string }> {
  const res = await fetch("/api/share/one-time", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      markdown,
      expire: "1day",
      password: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessageFromBody(text, res.status));
  const json = JSON.parse(text) as OneTimeShareResponse;
  if (!json.share?.url) throw new Error("Share did not return a URL");
  return { url: json.share.url, passphrase: json.passphrase ?? "" };
}

export async function copySharedGitLink(url: string, passphrase: string): Promise<string> {
  const blob = passphrase ? `${url}\nPassphrase: ${passphrase}` : url;
  await copyTextToClipboard(blob);
  return passphrase
    ? "Link and passphrase copied — 24h, burn after reading"
    : "Link copied — 24h, burn after reading";
}

export async function shareGitShowPatch(repoName: string, hash: string): Promise<string> {
  const json = await fetchGitJson<{ patch: string; subject: string; shortHash: string }>(
    repoApi(repoName, `/git/show?commit=${encodeURIComponent(hash)}&format=patch`),
  );
  const title = `${json.shortHash} ${json.subject}`.slice(0, 200);
  const markdown = ["# " + title, "", "```diff", json.patch, "```", ""].join("\n");
  const shared = await shareGitPatchMarkdown(title, markdown);
  return copySharedGitLink(shared.url, shared.passphrase);
}

export async function shareGitRangePatch(
  repoName: string,
  base?: string,
  head?: string,
): Promise<string> {
  const qs = new URLSearchParams({ format: "patch" });
  if (base) qs.set("base", base);
  if (head) qs.set("head", head);
  const json = await fetchGitJson<{ patch: string; base: string; head: string }>(
    repoApi(repoName, `/git/range?${qs}`),
  );
  const title = `${json.head} vs ${json.base}`.slice(0, 200);
  const markdown = ["# " + title, "", "```diff", json.patch, "```", ""].join("\n");
  const shared = await shareGitPatchMarkdown(title, markdown);
  return copySharedGitLink(shared.url, shared.passphrase);
}
