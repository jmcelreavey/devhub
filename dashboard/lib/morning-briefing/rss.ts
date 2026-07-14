/** RSS/Atom + HTML scrapers used by morning briefing sources. */
import type { LinkItem, RepoItem } from "./types";

export interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? m);
}

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const text = cdata ? cdata[1] : raw;
  return decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : undefined;
}

function atomLink(block: string): string | undefined {
  // Prefer rel="alternate"; fall back to the first <link href="…">.
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? decodeEntities(any[1]) : undefined;
}

export function parseRssItems(xml: string, limit = 8): RssItem[] {
  if (!xml) return [];
  const items: RssItem[] = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) && items.length < limit) {
    const block = m[0];
    const title = tag(block, "title");
    const link = tag(block, "link") || atomLink(block);
    if (!title || !link) continue;
    const pubDate = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    items.push({ title, link, pubDate });
  }
  return items;
}

// ── GitHub Trending parser ──────────────────────────────────────────────────

/**
 * Parse github.com/trending. Dependency-free because dragging in an HTML parser
 * for three fields from one page would be peak clown-shoes engineering.
 */
export function parseGithubTrendingRepos(html: string, limit = 20): RepoItem[] {
  if (!html) return [];
  const repos: RepoItem[] = [];
  const articleRe = /<article\b[\s\S]*?<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = articleRe.exec(html)) && repos.length < limit) {
    const article = match[0];
    const repoMatch = article.match(/<h2\b[\s\S]*?<a\b[^>]*href="\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!repoMatch) continue;

    const name = decodeEntities(repoMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, "").trim());
    if (!/^[^/]+\/[^/]+$/.test(name)) continue;

    const descriptionMatch = article.match(/<p\b[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const languageMatch = article.match(/<span\b[^>]*itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i);
    const starsMatch = article.match(/<a\b[^>]*href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/i);

    repos.push({
      name,
      url: `https://github.com/${repoMatch[1]}`,
      description: descriptionMatch ? unwrap(descriptionMatch[1]).replace(/\s+/g, " ") : null,
      stars: starsMatch ? Number(unwrap(starsMatch[1]).replace(/,/g, "")) || 0 : 0,
      language: languageMatch ? unwrap(languageMatch[1]) : null,
    });
  }
  return repos;
}

/**
 * Google News RSS titles arrive as "Headline - Publisher". Split the publisher
 * off the end so we can show it as a source label.
 */
export function splitGoogleNewsTitle(title: string): { title: string; source?: string } {
  const idx = title.lastIndexOf(" - ");
  if (idx > 0 && idx > title.length - 60) {
    return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
  }
  return { title: title.trim() };
}

// Anchor text that is navigation chrome, not an event title.
const EVENT_LINK_BLOCKLIST = new Set([
  "learn more",
  "read more",
  "find out more",
  "more info",
  "view all",
  "see all",
  "book now",
  "buy tickets",
  "what's on",
  "sign up now",
  "plan your trip",
]);

const DATE_HINT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|today|tomorrow|\d{1,2}(st|nd|rd|th)?)\b/i;

/**
 * Parse Tourism NI ("Discover Northern Ireland") what's-on HTML. Events are
 * `/event/<slug>/<id>/` anchors; we dedupe by the numeric id, keep the richest
 * title, and best-effort grab a trailing "(Sat 11 July)" date. Deliberately
 * tolerant of markup churn — it keys off the stable URL shape, not CSS classes.
 */
const DNI_ORIGIN = "https://discovernorthernireland.com";

/** Resolve a possibly-relative scraped href to an absolute URL so links open externally. */
function absoluteUrl(href: string, origin = DNI_ORIGIN): string {
  if (/^https?:\/\//i.test(href)) return href;
  return origin + (href.startsWith("/") ? href : `/${href}`);
}

export function parseDiscoverNiEvents(html: string, limit = 20): LinkItem[] {
  if (!html) return [];
  const re = /<a\b[^>]*href="([^"]*\/event\/[^"]*?\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  const byId = new Map<string, LinkItem>();
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, rawUrl, id, inner] = m;
    const url = absoluteUrl(rawUrl);
    const title = decodeEntities(inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).trim();
    if (title.length < 4 || EVENT_LINK_BLOCKLIST.has(title.toLowerCase())) continue;

    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const paren = after.match(/\(([^)]{2,40})\)/);
    const meta = paren && DATE_HINT.test(paren[1]) ? paren[1].trim() : undefined;

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { title, url, source: "Discover NI", meta });
      order.push(id);
    } else if (title.length > existing.title.length || (!existing.meta && meta)) {
      byId.set(id, {
        title: title.length > existing.title.length ? title : existing.title,
        url: existing.url,
        source: "Discover NI",
        meta: existing.meta ?? meta,
      });
    }
  }
  return order.map((id) => byId.get(id)!).slice(0, limit);
}

// ── Formatters ───────────────────────────────────────────────────────────────

