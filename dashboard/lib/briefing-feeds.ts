// Dynamic, AI/user-defined feeds for the bespoke briefing.
//
// Unlike the fixed source fetchers (weather, HN, GitHub trending …), these are
// added on the fly: the design chat can wire up a brand-new RSS feed or JSON API
// when you ask for one ("add the r/northernireland feed", "pull in this podcast
// RSS"). They're persisted to notes/.config so they survive restarts and the
// daily data refresh, and every fetch is best-effort — one dead feed never sinks
// the briefing.

import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import { parseRssItems, decodeEntities, type LinkItem } from "@/lib/morning-briefing";

export type FeedKind = "rss" | "json";

export interface DynamicFeed {
  id: string;
  label: string;
  url: string;
  kind: FeedKind;
  /** JSON feeds: dotted path to the array of items (e.g. "data.children"). */
  itemsPath?: string;
  /** JSON feeds: candidate field for an item's title. */
  titleField?: string;
  /** JSON feeds: candidate field for an item's link. */
  urlField?: string;
  addedAt: string;
}

export interface FeedResult {
  id: string;
  label: string;
  kind: FeedKind;
  url: string;
  items: LinkItem[];
  error?: string;
}

const FEEDS_VERSION = 1;
const TIMEOUT_MS = 8000;
const UA = "DevHub-Dashboard-Briefing/1.0";

interface StoredFeeds {
  version: number;
  feeds: DynamicFeed[];
}

function feedsFile(): string {
  return path.join(getRepoRoot(), "notes", ".config", "briefing-feeds.json");
}

export function readFeeds(): DynamicFeed[] {
  const stored = safeReadJSON<StoredFeeds | null>(feedsFile(), null);
  if (!stored || !Array.isArray(stored.feeds)) return [];
  return stored.feeds;
}

async function saveFeeds(feeds: DynamicFeed[]): Promise<void> {
  const file = feedsFile();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ version: FEEDS_VERSION, feeds } satisfies StoredFeeds, null, 2));
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "feed";
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Feed";
  }
}

export interface AddFeedInput {
  url: string;
  label?: string;
  kind?: FeedKind;
  itemsPath?: string;
  titleField?: string;
  urlField?: string;
}

/** Add (or return an existing) dynamic feed. Returns null on an invalid URL. */
export async function addFeed(input: AddFeedInput): Promise<DynamicFeed | null> {
  const url = input.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const feeds = readFeeds();
  const existing = feeds.find((f) => f.url === url);
  if (existing) return existing;

  const label = input.label?.trim() || hostLabel(url);
  const kind: FeedKind = input.kind === "json" ? "json" : "rss";
  const base = slug(label);
  let id = base;
  let n = 1;
  while (feeds.some((f) => f.id === id)) id = `${base}-${++n}`;

  const feed: DynamicFeed = {
    id,
    label,
    url,
    kind,
    itemsPath: input.itemsPath,
    titleField: input.titleField,
    urlField: input.urlField,
    addedAt: new Date().toISOString(),
  };
  await saveFeeds([...feeds, feed]);
  return feed;
}

export async function removeFeed(id: string): Promise<boolean> {
  const feeds = readFeeds();
  const next = feeds.filter((f) => f.id !== id);
  if (next.length === feeds.length) return false;
  await saveFeeds(next);
  return true;
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getByPath(obj: unknown, dotted?: string): unknown {
  if (!dotted) return obj;
  return dotted.split(".").reduce<unknown>(
    (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function pickString(obj: Record<string, unknown>, fields: string[]): string | undefined {
  for (const f of fields) {
    if (!f) continue;
    const v = obj[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

async function fetchOneFeed(feed: DynamicFeed, limit: number): Promise<FeedResult> {
  const base: FeedResult = { id: feed.id, label: feed.label, kind: feed.kind, url: feed.url, items: [] };
  const text = await fetchText(feed.url);
  if (!text) return { ...base, error: "unreachable" };

  if (feed.kind === "json") {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ...base, error: "bad-json" };
    }
    const arr = getByPath(json, feed.itemsPath);
    const list = Array.isArray(arr) ? arr : Array.isArray(json) ? json : [];
    const items: LinkItem[] = [];
    for (const raw of list.slice(0, limit)) {
      if (!raw || typeof raw !== "object") continue;
      const outer = raw as Record<string, unknown>;
      // Reddit-style { kind, data: {...} } wrappers are common; unwrap them.
      const inner =
        outer.data && typeof outer.data === "object" ? (outer.data as Record<string, unknown>) : outer;
      const title = pickString(inner, [feed.titleField ?? "", "title", "name", "headline", "text"]);
      if (!title) continue;
      const rawUrl = pickString(inner, [feed.urlField ?? "", "url", "link", "permalink", "html_url", "webUrl"]);
      const url = rawUrl ? absoluteUrl(rawUrl, feed.url) : feed.url;
      items.push({ title: decodeEntities(title).slice(0, 200), url, source: feed.label });
    }
    return { ...base, items };
  }

  // RSS / Atom
  const parsed = parseRssItems(text, limit);
  const items: LinkItem[] = parsed.map((it) => ({
    title: it.title.slice(0, 200),
    url: it.link,
    source: feed.label,
    meta: it.pubDate,
  }));
  return { ...base, items };
}

/** Fetch every configured dynamic feed in parallel; failures resolve to empty. */
export async function fetchDynamicFeeds(limitPerFeed = 8): Promise<FeedResult[]> {
  const feeds = readFeeds();
  if (feeds.length === 0) return [];
  return Promise.all(
    feeds.map((f) =>
      fetchOneFeed(f, limitPerFeed).catch(
        (): FeedResult => ({ id: f.id, label: f.label, kind: f.kind, url: f.url, items: [], error: "failed" }),
      ),
    ),
  );
}
