import {
  STANDUP_STORAGE_KEYS,
  fetchStandup,
  readExcludedRepos,
} from "@/lib/standup-params";
import { copyTextToClipboard } from "@/lib/clipboard";

function readTime(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(key) || undefined;
}

/** Shared by Today button and command palette — one fetch + clipboard path. */
export async function copyStandupMarkdownToClipboard(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const result = await fetchStandup({
    startTime: readTime(STANDUP_STORAGE_KEYS.startTime),
    endTime: readTime(STANDUP_STORAGE_KEYS.endTime),
    excludeRepos: readExcludedRepos(),
  });
  if (!result.ok) return result;

  try {
    await copyTextToClipboard(result.data.markdown);
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "Clipboard unavailable — copy blocked by the browser; try again from a user tap or check permissions.",
    };
  }
}
