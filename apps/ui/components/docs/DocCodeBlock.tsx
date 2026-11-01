"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

const LANG_LABELS: Record<string, string> = {
  bash: "Shell",
  sh: "Shell",
  shell: "Shell",
  zsh: "Shell",
  console: "Shell",
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  toml: "TOML",
  rust: "Rust",
  rs: "Rust",
  sql: "SQL",
  css: "CSS",
  html: "HTML",
  text: "Text",
  txt: "Text",
};

export function DocCodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const label = LANG_LABELS[lang] ?? (lang ? lang.toUpperCase() : "");

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [value]);

  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span className="docs-code-lang">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="docs-code-copy"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="docs-code-pre">
        <code>{value}</code>
      </pre>
    </div>
  );
}
