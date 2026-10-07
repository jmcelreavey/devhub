import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";
import type { ProviderUsage, UsageSpend } from "./types";

interface TokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
}

/** USD per 1M tokens, standard tier. Output includes reasoning tokens. */
interface ModelPrice {
  input: number;
  cachedInput: number;
  /** Omitted where OpenAI lists no separate cache-write price; input price applies. */
  cacheWrite?: number;
  output: number;
}

// Seeded from https://developers.openai.com/api/docs/pricing (checked 2026-09-24).
// Exact model ids only: a prefix match would price "gpt-5.5-pro" as "gpt-5.5".
// Unknown ids are filled at runtime from models.dev (OpenAI section) so a new
// Codex model does not sit unpriced until someone edits this table.
export const CODEX_MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
};

/** Live book used while tallying. Seed + optional models.dev fill-ins. */
let priceBook: Record<string, ModelPrice> = { ...CODEX_MODEL_PRICES };
/** Fingerprint of priceBook keys; when it changes, drop rollout tallies. */
let pricedWithFingerprint = "";

const MODELS_DEV_URL = "https://models.dev/api.json";
const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function priceCachePath(): string {
  return path.join(os.homedir(), ".cache", "devhub", "codex-model-prices.json");
}

/** Map models.dev OpenAI `cost` rows onto our ModelPrice shape. */
export function pricesFromModelsDevOpenAi(payload: unknown): Record<string, ModelPrice> {
  if (!payload || typeof payload !== "object") return {};
  const openai = (payload as Record<string, unknown>).openai;
  if (!openai || typeof openai !== "object") return {};
  const models = (openai as Record<string, unknown>).models;
  if (!models || typeof models !== "object") return {};
  const out: Record<string, ModelPrice> = {};
  for (const [id, row] of Object.entries(models as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const cost = (row as Record<string, unknown>).cost;
    if (!cost || typeof cost !== "object") continue;
    const c = cost as Record<string, unknown>;
    if (typeof c.input !== "number" || typeof c.output !== "number") continue;
    const price: ModelPrice = {
      input: c.input,
      cachedInput: typeof c.cache_read === "number" ? c.cache_read : c.input * 0.1,
      output: c.output,
    };
    if (typeof c.cache_write === "number") price.cacheWrite = c.cache_write;
    out[id] = price;
  }
  return out;
}

function readPriceCache(): { fetchedAt: number; prices: Record<string, ModelPrice> } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(priceCachePath(), "utf8")) as {
      fetchedAt?: unknown;
      prices?: unknown;
    };
    if (typeof raw.fetchedAt !== "number" || !raw.prices || typeof raw.prices !== "object") return null;
    return { fetchedAt: raw.fetchedAt, prices: raw.prices as Record<string, ModelPrice> };
  } catch {
    return null;
  }
}

function writePriceCache(prices: Record<string, ModelPrice>, fetchedAt: number): void {
  const file = priceCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fetchedAt, prices }, null, 2) + "\n");
}

/**
 * Merge remote prices under the hand-checked seed. Returns true when the live
 * book gained at least one new model id (caller should drop rollout caches).
 */
export function applyRemoteCodexPrices(remote: Record<string, ModelPrice>): boolean {
  const next = { ...remote, ...CODEX_MODEL_PRICES };
  const gained = Object.keys(next).some((id) => !(id in priceBook));
  priceBook = next;
  return gained;
}

/** Refresh the price book from disk cache and, when stale, models.dev. */
export async function refreshCodexModelPrices(now = Date.now()): Promise<void> {
  const cached = readPriceCache();
  if (cached) applyRemoteCodexPrices(cached.prices);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) return;
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return;
    const remote = pricesFromModelsDevOpenAi(await response.json());
    if (!Object.keys(remote).length) return;
    applyRemoteCodexPrices(remote);
    writePriceCache(remote, now);
  } catch {
    // Offline or models.dev down: keep seed + any disk cache we already applied.
  }
}

/** Test helper: reset the live book to the compile-time seed. */
export function resetCodexModelPricesForTests(): void {
  priceBook = { ...CODEX_MODEL_PRICES };
  pricedWithFingerprint = "";
}

export interface DayTotals {
  costUsd: number;
  tokens: number;
  unpricedTokens: Record<string, number>;
}

/** Cost of one response. Cached and cache-write tokens are subsets of input_tokens. */
export function responseCostUsd(price: ModelPrice, usage: TokenUsage): number {
  const fresh = Math.max(0, usage.input_tokens - usage.cached_input_tokens - usage.cache_write_input_tokens);
  return (
    fresh * price.input +
    usage.cached_input_tokens * price.cachedInput +
    usage.cache_write_input_tokens * (price.cacheWrite ?? price.input) +
    usage.output_tokens * price.output
  ) / 1_000_000;
}

function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
  if (typeof v.input_tokens !== "number" || typeof v.output_tokens !== "number") return null;
  return { input_tokens: num("input_tokens"), cached_input_tokens: num("cached_input_tokens"), cache_write_input_tokens: num("cache_write_input_tokens"), output_tokens: num("output_tokens") };
}

function subtract(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens - b.input_tokens,
    cached_input_tokens: a.cached_input_tokens - b.cached_input_tokens,
    cache_write_input_tokens: a.cache_write_input_tokens - b.cache_write_input_tokens,
    output_tokens: a.output_tokens - b.output_tokens,
  };
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addUsage(days: Map<string, DayTotals>, timestamp: string, model: string, usage: TokenUsage): void {
  const key = localDayKey(new Date(timestamp));
  const day = days.get(key) ?? { costUsd: 0, tokens: 0, unpricedTokens: {} };
  const tokens = usage.input_tokens + usage.output_tokens;
  const price = priceBook[model];
  day.tokens += tokens;
  if (price) day.costUsd += responseCostUsd(price, usage);
  else day.unpricedTokens[model] = (day.unpricedTokens[model] ?? 0) + tokens;
  days.set(key, day);
}

/**
 * Sum one rollout's token usage per local day.
 *
 * Newer CLIs write a `token_usage_record` per API response, including the
 * compaction calls that the running totals leave out (~250k input tokens
 * each), so those win whenever a file has any. Older rollouts only have
 * `token_count` events carrying the thread's running total; differencing
 * consecutive totals counts each response once even when an event repeats.
 * The first total in a file (or one that goes backwards) uses
 * `last_token_usage` instead, because a resumed thread's total already
 * includes usage logged in another file.
 */
export async function tallyRollout(lines: AsyncIterable<string> | Iterable<string>): Promise<Map<string, DayTotals>> {
  const fromRecords = new Map<string, DayTotals>();
  const fromTotals = new Map<string, DayTotals>();
  let model = "unknown";
  let previous: TokenUsage | null = null;
  for await (const line of lines) {
    // Cheap substring gate: most lines are multi-KB transcript items we never need to parse.
    if (!line.includes('"token_count"') && !line.includes('"token_usage_record"') && !line.includes('"turn_context"') && !line.includes('"thread_settings_applied"')) continue;
    let event: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try { event = JSON.parse(line); } catch { continue; }
    const payload = event.payload ?? {};
    if (event.type === "turn_context" && typeof payload.model === "string") { model = payload.model; continue; }
    const settings = payload.thread_settings as { model?: unknown } | undefined;
    if (payload.type === "thread_settings_applied" && typeof settings?.model === "string") { model = settings.model; continue; }
    if (!event.timestamp) continue;

    if (event.type === "token_usage_record") {
      const usage = readUsage(payload.usage);
      if (usage) addUsage(fromRecords, event.timestamp, model, usage);
      continue;
    }
    if (payload.type !== "token_count") continue;
    const info = payload.info as { total_token_usage?: unknown; last_token_usage?: unknown } | null | undefined;
    const total = readUsage(info?.total_token_usage);
    if (!total) continue;
    const delta = previous && total.input_tokens >= previous.input_tokens ? subtract(total, previous) : readUsage(info?.last_token_usage);
    previous = total;
    if (delta && (delta.input_tokens > 0 || delta.output_tokens > 0)) addUsage(fromTotals, event.timestamp, model, delta);
  }
  return fromRecords.size > 0 ? fromRecords : fromTotals;
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

// A month of rollouts runs to hundreds of MB; only re-read files that changed.
const rolloutCache = new Map<string, { mtimeMs: number; size: number; days: Map<string, DayTotals> }>();

async function rolloutFilesSince(sinceMs: number): Promise<{ file: string; mtimeMs: number; size: number }[]> {
  const found: { file: string; mtimeMs: number; size: number }[] = [];
  for (const dir of ["sessions", "archived_sessions"].map((name) => path.join(codexHome(), name))) {
    let entries: string[];
    try { entries = await fs.promises.readdir(dir, { recursive: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat && stat.mtimeMs >= sinceMs) found.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return found;
}

async function tallyLocalUsage(now: Date): Promise<{ today: DayTotals; month: DayTotals }> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthPrefix = localDayKey(monthStart).slice(0, 7);
  const todayKey = localDayKey(now);
  const files = await rolloutFilesSince(monthStart.getTime());
  const live = new Set(files.map((f) => f.file));
  for (const file of rolloutCache.keys()) if (!live.has(file)) rolloutCache.delete(file);

  const today: DayTotals = { costUsd: 0, tokens: 0, unpricedTokens: {} };
  const month: DayTotals = { costUsd: 0, tokens: 0, unpricedTokens: {} };
  for (const { file, mtimeMs, size } of files) {
    let cached = rolloutCache.get(file);
    if (!cached || cached.mtimeMs !== mtimeMs || cached.size !== size) {
      const stream = fs.createReadStream(file, { encoding: "utf8" });
      try {
        cached = { mtimeMs, size, days: await tallyRollout(readline.createInterface({ input: stream, crlfDelay: Infinity })) };
      } finally {
        stream.destroy();
      }
      rolloutCache.set(file, cached);
    }
    for (const [key, day] of cached.days) {
      if (!key.startsWith(monthPrefix)) continue;
      const targets = key === todayKey ? [month, today] : [month];
      for (const target of targets) {
        target.costUsd += day.costUsd;
        target.tokens += day.tokens;
        for (const [model, tokens] of Object.entries(day.unpricedTokens)) target.unpricedTokens[model] = (target.unpricedTokens[model] ?? 0) + tokens;
      }
    }
  }
  return { today, month };
}

const costsSchema = z.object({
  data: z.array(z.object({
    start_time: z.number(),
    results: z.array(z.object({ amount: z.object({ value: z.number(), currency: z.string() }) })),
  })),
});

/** Real billed spend from the Costs API. Needs an org admin key; project keys lack api.usage.read. Buckets are UTC days. */
async function loadBilledSpend(adminKey: string, now: Date): Promise<{ today: number; month: number; currency: string }> {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const response = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${monthStart}&bucket_width=1d&limit=31`, {
    headers: { Authorization: `Bearer ${adminKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("OPENAI_ADMIN_KEY was rejected; it must be an organization admin key");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { data } = costsSchema.parse(await response.json());
  let today = 0;
  let month = 0;
  let currency = "USD";
  for (const bucket of data) {
    for (const result of bucket.results) {
      currency = result.amount.currency.toUpperCase();
      month += result.amount.value;
      if (bucket.start_time === todayStart) today += result.amount.value;
    }
  }
  return { today, month, currency };
}

function authMode(): string | null {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(codexHome(), "auth.json"), "utf8")) as { auth_mode?: unknown };
    return typeof auth.auth_mode === "string" ? auth.auth_mode : null;
  } catch {
    return null;
  }
}

export async function loadCodexUsage(now = new Date()): Promise<ProviderUsage> {
  const base = { id: "codex", name: "Codex", meters: [] } satisfies Partial<ProviderUsage>;
  if (!fs.existsSync(path.join(codexHome(), "sessions"))) return { ...base, spend: [], status: "unavailable", summary: "No Codex sessions yet", message: "Usage appears after your first Codex session on this machine. You can ignore this if you don't use Codex." };
  const mode = authMode();
  const notes: string[] = [];
  const spend: UsageSpend[] = [];

  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim();
  if (adminKey) {
    try {
      const billed = await loadBilledSpend(adminKey, now);
      spend.push(
        { label: "Today (UTC)", amount: billed.today, currency: billed.currency, source: "billed" },
        { label: "This month", amount: billed.month, currency: billed.currency, source: "billed" },
      );
      notes.push("Billing can lag by a few hours; the estimate covers the gap.");
    } catch (err) {
      notes.push(`Billed spend unavailable (${err instanceof Error ? err.message : "request failed"}).`);
    }
  } else {
    notes.push("Estimated from local Codex logs at list prices. Set OPENAI_ADMIN_KEY for billed spend.");
  }

  await refreshCodexModelPrices();
  const priceFp = Object.keys(priceBook).sort().join("|");
  if (priceFp !== pricedWithFingerprint) {
    rolloutCache.clear();
    pricedWithFingerprint = priceFp;
  }
  const local = await tallyLocalUsage(now);
  spend.push(
    { label: "Today", amount: local.today.costUsd, currency: "USD", source: "estimate" },
    { label: "This month", amount: local.month.costUsd, currency: "USD", source: "estimate" },
  );
  const unpriced = Object.entries(local.month.unpricedTokens);
  if (unpriced.length) notes.push(`No price for ${unpriced.map(([model, tokens]) => `${model} (${tokens.toLocaleString()} tokens)`).join(", ")}.`);
  if (mode && mode !== "apikey") notes.push("Codex is signed in with ChatGPT, so these are API-equivalent costs, not charges.");

  return { ...base, plan: mode === "apikey" ? "API key" : undefined, status: "ok", spend, message: notes.join(" ") };
}
