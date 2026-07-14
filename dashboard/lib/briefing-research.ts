import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import type { ResearchCard, ResearchSignal } from "./morning-briefing";

const DEFAULT_MAX_AGE_HOURS = 72;
const LINK_RE = /\[([^\]]{4,160})\]\((https?:\/\/[^)]+)\)|https?:\/\/\S+/g;
const SOURCE_RE = /\b(reddit|x|twitter|youtube|tiktok|instagram|hacker news|hn|polymarket|github|web|arxiv|techmeme|bluesky)\b/i;
const METRIC_RE = /\b\d[\d,.]*\s?(?:upvotes?|points?|comments?|likes?|views?|stars?|%|odds|volume|votes?)\b/i;

export function researchDir(): string {
  const configured = process.env.LAST30DAYS_MEMORY_DIR?.trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(getRepoRoot(), "dashboard", configured);
  return path.join(getRepoRoot(), "notes", "research");
}

function maxAgeMs(): number {
  const raw = Number(process.env.LAST30DAYS_MAX_AGE_HOURS ?? DEFAULT_MAX_AGE_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_AGE_HOURS;
  return hours * 60 * 60 * 1000;
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading && heading.length <= 140 ? heading : `Last 30 days: ${fallback}`).replace(/^\/last30days\s+/i, "");
}

function summaryFromMarkdown(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && !l.startsWith("---") && !/^\[!?[^\]]+\]/.test(l));
  const firstPara = lines.find((l) => !l.startsWith("-") && !l.startsWith("*") && l.length > 60) ?? lines[0] ?? "Cached research is available.";
  return firstPara.replace(/\s+/g, " ").slice(0, 260);
}

function stripMarkdownLink(line: string): { title: string; url?: string } {
  const md = line.match(/\[([^\]]{4,160})\]\((https?:\/\/[^)]+)\)/);
  if (md) return { title: md[1].trim(), url: md[2].trim() };
  const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "");
  const title = line.replace(/^[-*]\s*/, "").replace(/https?:\/\/\S+/, "").replace(/[\[\]()*_`#>]/g, "").trim();
  return { title: title || url || line.slice(0, 120), url };
}

function signalsFromMarkdown(markdown: string): ResearchSignal[] {
  const candidates = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 12 && line.length < 360)
    .filter((line) => /^[-*]\s+/.test(line) || LINK_RE.test(line) || SOURCE_RE.test(line) || METRIC_RE.test(line));

  const seen = new Set<string>();
  const signals: ResearchSignal[] = [];
  for (const raw of candidates) {
    LINK_RE.lastIndex = 0;
    const { title, url } = stripMarkdownLink(raw);
    const cleanedTitle = title.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").slice(0, 150);
    if (cleanedTitle.length < 8 || seen.has(cleanedTitle.toLowerCase())) continue;
    seen.add(cleanedTitle.toLowerCase());
    const source = raw.match(SOURCE_RE)?.[0];
    const metric = raw.match(METRIC_RE)?.[0];
    signals.push({ title: cleanedTitle, url, source, metric, note: raw.replace(/^[-*]\s*/, "").slice(0, 220) });
    if (signals.length >= 5) break;
  }
  return signals;
}

function latestMarkdownForInterest(interest: string): { path: string; mtime: Date; markdown: string } | null {
  const dir = researchDir();
  if (!fs.existsSync(dir)) return null;
  const target = slug(interest);
  const maxAge = maxAgeMs();
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && slug(entry.name).includes(target))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      return { file, stat: fs.statSync(file) };
    })
    .filter(({ stat }) => Date.now() - stat.mtimeMs <= maxAge)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const picked = files[0];
  if (!picked) return null;
  return { path: picked.file, mtime: picked.stat.mtime, markdown: fs.readFileSync(picked.file, "utf-8") };
}

export function interestsNeedingResearch(interests: string[]): string[] {
  return [...new Set(interests.map((i) => i.trim()).filter(Boolean))].filter((interest) => !latestMarkdownForInterest(interest));
}

export function loadResearchCards(interests: string[]): ResearchCard[] {
  const cards: ResearchCard[] = [];
  for (const interest of interests) {
    const found = latestMarkdownForInterest(interest);
    if (!found) continue;
    const relativePath = path.relative(getRepoRoot(), found.path);
    cards.push({
      interest,
      title: titleFromMarkdown(found.markdown, interest),
      summary: summaryFromMarkdown(found.markdown),
      updatedAt: found.mtime.toISOString(),
      sourcePath: relativePath,
      signals: signalsFromMarkdown(found.markdown),
    });
  }
  return cards;
}
