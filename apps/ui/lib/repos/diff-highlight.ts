import type { ElementContent } from "hast";
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import css from "refractor/css";
import go from "refractor/go";
import ini from "refractor/ini";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import less from "refractor/less";
import markdown from "refractor/markdown";
import python from "refractor/python";
import rust from "refractor/rust";
import scss from "refractor/scss";
import sql from "refractor/sql";
import tsxLang from "refractor/tsx";
import typescriptLang from "refractor/typescript";
import yaml from "refractor/yaml";

// Registered once at module load. Curated set — add an import + map entry when
// a repo file type renders unstyled. `refractor/core` already covers markup
// (html/xml/svg), plain css, and javascript.
for (const lang of [
  bash,
  css,
  go,
  ini,
  javascript,
  json,
  jsx,
  less,
  markdown,
  python,
  rust,
  scss,
  sql,
  tsxLang,
  typescriptLang,
  yaml,
]) {
  refractor.register(lang);
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  go: "go",
  rs: "rust",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  sql: "sql",
  html: "markup",
  xml: "markup",
  svg: "markup",
};

/** Prism language id for a repo-relative path, or null when unknown. */
export function langForPath(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base) || /^\.env/i.test(base)) return "bash";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  return EXT_LANG[ext] ?? null;
}

const cache = new Map<string, ElementContent[] | null>();

/**
 * Highlight one diff line into HAST nodes. Per-line (GitHub-style): a string
 * or comment spanning lines loses context — the accepted tradeoff for a diff
 * view. Null means "no tokens, render plain text".
 */
export function highlightDiffLine(text: string, lang: string): ElementContent[] | null {
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size > 4000) cache.clear();
  let out: ElementContent[] | null = null;
  try {
    // refractor types the root as RootContent[] (doctype etc.) — diff lines only
    // ever contain elements and text.
    out = refractor.highlight(text, lang).children.filter(
      (node): node is ElementContent => node.type === "element" || node.type === "text",
    );
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}
