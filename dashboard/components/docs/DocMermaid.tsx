"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@/components/shell/ThemeToggle";
import {
  buildMermaidTheme,
  DARK_FALLBACK_PALETTE,
  LIGHT_FALLBACK_PALETTE,
} from "@/lib/docs/mermaid-theme";

/**
 * Read-only Mermaid renderer for docs.
 *
 * `components/diagrams/MermaidBlock` is the editor-bound version and needs a
 * BlockNote context; docs render outside the editor, so this is the plain
 * counterpart. Failures render the source rather than an empty box — a broken
 * diagram should still tell you what it was trying to say.
 */
export function DocMermaid({ code }: { code: string }) {
  const { mode } = useTheme();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!code.trim()) return;
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: readPaletteVariables(mode === "dark"),
        });
        const { svg: out } = await mermaid.render(`docs-mermaid-${renderId}`, code);
        if (!cancelled) {
          setSvg(out);
          setError("");
        }
      } catch (e) {
        console.error("[docs] mermaid render failed", e);
        if (!cancelled) {
          setSvg("");
          setError(e instanceof Error ? e.message : "Invalid diagram");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, mode, renderId]);

  useEffect(() => {
    if (host.current) host.current.innerHTML = svg;
  }, [svg]);

  if (error) {
    return (
      <figure className="docs-figure">
        <pre className="docs-code-pre">
          <code>{code}</code>
        </pre>
        <figcaption className="docs-figure-caption text-danger">
          Diagram failed to render: {error}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="docs-figure docs-mermaid">
      <div ref={host} aria-label="Diagram" />
      {svg ? null : <div className="skeleton" style={{ height: 160 }} />}
    </figure>
  );
}

/** Read the live design tokens, falling back to the shipped palette. */
function readPaletteVariables(isDark: boolean): Record<string, string> {
  const fallback = isDark ? DARK_FALLBACK_PALETTE : LIGHT_FALLBACK_PALETTE;
  if (typeof window === "undefined") return buildMermaidTheme(fallback, isDark);
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, backup: string) => styles.getPropertyValue(name).trim() || backup;
  return buildMermaidTheme(
    {
      surface: token("--bg-surface", fallback.surface),
      elevated: token("--bg-elevated", fallback.elevated),
      border: token("--border", fallback.border),
      text: token("--text", fallback.text),
      muted: token("--text-muted", fallback.muted),
      accent: token("--accent", fallback.accent),
    },
    isDark,
  );
}
