import { ttlCache, type TtlCached } from "@/lib/ttl-cache";
import { loadClaudeUsage } from "./claude";
import { loadCodexUsage } from "./codex";
import { loadCopilotUsage } from "./copilot";
import { loadCursorUsage } from "./cursor";
import { loadOpenRouterUsage } from "./openrouter";
import { loadZaiUsage } from "./zai";
import { UsageLoadError } from "./load-error";
import type { ProviderUsage, UsageProviderId } from "./types";

const CACHE_MS = 5 * 60_000;

const sources: { id: UsageProviderId; name: string; load: TtlCached<ProviderUsage | null> }[] = [
  { id: "claude", name: "Claude", load: ttlCache(loadClaudeUsage, CACHE_MS) },
  { id: "codex", name: "Codex", load: ttlCache(() => loadCodexUsage(), CACHE_MS) },
  { id: "cursor", name: "Cursor", load: ttlCache(loadCursorUsage, CACHE_MS) },
  { id: "copilot", name: "GitHub Copilot", load: ttlCache(loadCopilotUsage, CACHE_MS) },
  { id: "openrouter", name: "OpenRouter", load: ttlCache(loadOpenRouterUsage, CACHE_MS) },
  { id: "zai", name: "z.ai", load: ttlCache(loadZaiUsage, CACHE_MS) },
];

/**
 * One provider failing (expired token, endpoint moved) must not blank the others.
 * A loader returning null means the provider isn't installed or signed in, so it is left out.
 */
export async function loadAgentUsage(refresh?: string): Promise<ProviderUsage[]> {
  const results = await Promise.all(sources.map(async ({ id, name, load }) => {
    try {
      if (id === refresh) load.invalidate();
      return await load();
    } catch (err) {
      console.error(`[agent-usage:${id}]`, err);
      return {
        id, name, status: "error", meters: [], spend: [],
        summary: `Couldn't load ${name} usage`,
        message: `Couldn't load ${name} usage. Try again.`,
        reason: err instanceof UsageLoadError ? err.reason : "Unexpected error. The DevHub server log has the details.",
      } satisfies ProviderUsage;
    }
  }));
  return results.filter((usage): usage is ProviderUsage => usage !== null);
}
