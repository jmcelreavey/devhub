/** Lexical TF-IDF ranking over vault text — not embedding/vector search. */
import fs from "node:fs";
import path from "node:path";
import { detectJsonFileType, extractPlainTextFromBlockNote, extractPlainTextFromTldraw } from "./extract.ts";
import type { SearchNotesOptions } from "./search.ts";

export interface LexicalSearchResult {
  path: string;
  score: number;
  preview: string;
}

const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "in", "on", "to", "for", "of", "is", "it", "with", "as", "by", "from"]);

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/g).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

interface IndexedDoc {
  path: string;
  tokens: string[];
  text: string;
}

function indexVault(root: string, options: SearchNotesOptions): IndexedDoc[] {
  const { includePath = () => true, includeTldraw = true } = options;
  const docs: IndexedDoc[] = [];
  const resolvedRoot = path.resolve(root);

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.name.endsWith(".json")) continue;
      const relPath = path.relative(resolvedRoot, fullPath);
      if (!includePath(relPath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as unknown;
        const fileType = detectJsonFileType(parsed);
        let text: string | null = null;
        if (fileType === "tldraw" && includeTldraw) text = extractPlainTextFromTldraw(parsed);
        else if (fileType === "blocknote") text = extractPlainTextFromBlockNote(Array.isArray(parsed) ? parsed : [parsed]);
        else continue;
        const tokens = tokenize(text);
        if (tokens.length > 0) docs.push({ path: relPath, tokens, text });
      } catch { /* skip */ }
    }
  };

  walk(root);
  return docs;
}

export function lexicalSearchNotes(root: string, query: string, options: SearchNotesOptions = {}): LexicalSearchResult[] {
  const limit = options.limit ?? 50;
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const docs = indexVault(root, options);
  if (docs.length === 0) return [];

  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc.tokens)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  const scored: LexicalSearchResult[] = [];
  for (const doc of docs) {
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of queryTokens) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const df = docFreq.get(term) ?? 1;
      score += (1 + Math.log(freq)) * (Math.log((docs.length + 1) / (df + 1)) + 1);
    }
    if (score <= 0) continue;
    const preview = doc.text.split("\n").find((l) => queryTokens.some((t) => l.toLowerCase().includes(t))) ?? doc.text.split("\n")[0] ?? "";
    scored.push({ path: doc.path, score: Math.round(score * 100) / 100, preview: preview.slice(0, 200) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
