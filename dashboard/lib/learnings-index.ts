import fs from "node:fs";
import path from "node:path";
import { blocksToText } from "./markdown-convert";
import type { LearningDetail, LearningEntry } from "./learnings-types";

export type { LearningDetail, LearningEntry } from "./learnings-types";

function blocksToMarkdown(blocks: unknown): string {
  return blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
}

function titleFromText(text: string, category: string): string {
  const first = text.split("\n")[0];
  return first?.replace(/^#+\s*/, "") || category.split("/").pop() || category;
}

function buildPreview(text: string): string {
  const bodyLines = text
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() && !/^#+\s/.test(line));
  return bodyLines.slice(0, 3).join("\n").slice(0, 200);
}

function parseLearningFile(filePath: string, category: string): LearningEntry | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const blocks = JSON.parse(raw) as unknown;
    const stat = fs.statSync(filePath);
    const text = blocksToMarkdown(blocks);
    const lines = text.split("\n");
    return {
      category,
      title: titleFromText(text, category),
      size: stat.size,
      modified: stat.mtimeMs,
      lineCount: lines.length,
      preview: buildPreview(text),
    };
  } catch {
    return null;
  }
}

function walkLearningsJson(dir: string, baseDir: string, entries: LearningEntry[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "archive") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLearningsJson(full, baseDir, entries);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    const rel = path.relative(baseDir, full).replace(/\\/g, "/");
    const category = rel.replace(/\.json$/, "");
    const parsed = parseLearningFile(full, category);
    if (parsed) entries.push(parsed);
  }
}

export function listLearningEntries(learningsDir: string): LearningEntry[] {
  const entries: LearningEntry[] = [];
  walkLearningsJson(learningsDir, learningsDir, entries);
  return entries.sort((a, b) => b.modified - a.modified);
}

export function readLearningDetail(learningsDir: string, category: string): LearningDetail | null {
  if (category.includes("..") || path.isAbsolute(category)) return null;
  const filePath = path.join(learningsDir, `${category}.json`);
  if (!filePath.startsWith(learningsDir) || !fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const blocks = JSON.parse(raw) as unknown;
    const stat = fs.statSync(filePath);
    const content = blocksToMarkdown(blocks);
    const lines = content.split("\n");
    return {
      category,
      title: titleFromText(content, category),
      content,
      size: stat.size,
      modified: stat.mtimeMs,
      lineCount: lines.length,
      preview: buildPreview(content),
    };
  } catch {
    return null;
  }
}
