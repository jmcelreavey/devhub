"use client";

import Link from "next/link";
import { ExternalLink, Hash } from "lucide-react";
import {
  findHighlightRange,
  searchCategoryFromPath,
  searchFileHref,
  type SearchFileGroup,
} from "@/lib/search-ui";

function highlightSearchText(text: string, query: string) {
  const range = findHighlightRange(text, query);
  if (!range) return text;
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="rounded-sm px-0.5" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </>
  );
}

export interface SearchResultListProps {
  files: SearchFileGroup[];
  query: string;
  semantic?: boolean;
}

export function SearchResultList({ files, query, semantic = false }: SearchResultListProps) {
  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => {
        const cat = searchCategoryFromPath(file.path);
        const Icon = cat.icon;
        const displayPath = file.path.replace(/\.json$/, "");
        const href = searchFileHref(file.path);

        return (
          <div key={file.path} className="card overflow-hidden" style={{ padding: 0 }}>
            <div
              className="flex items-start justify-between gap-3 px-3.5 py-2.5"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <Icon size={14} className="shrink-0 mt-0.5" style={{ color: cat.color }} />
                <div className="min-w-0">
                  <Link href={href} className="text-sm font-medium break-words leading-snug hover:underline" style={{ color: "var(--text)" }}>
                    {displayPath}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="badge badge-muted text-[10px]">{cat.label}</span>
                    {semantic && file.score > 0 ? (
                      <span className="text-[10px] tabular-nums" style={{ color: "var(--text-subtle)" }}>
                        score {file.score}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-subtle)" }}>
                  <Hash size={10} />
                  {file.matches.length}
                </span>
                <Link href={href} className="hub-icon-btn" aria-label={`Open ${displayPath}`}>
                  <ExternalLink size={12} />
                </Link>
              </div>
            </div>
            <div className="px-3.5 py-2">
              {file.matches.slice(0, 5).map((match, i) => (
                <div
                  key={`${match.line}-${i}`}
                  className="flex gap-2 py-1"
                  style={{ borderBottom: i < Math.min(file.matches.length, 5) - 1 ? "1px solid var(--border-muted)" : undefined }}
                >
                  <span className="text-[11px] font-mono w-8 text-right shrink-0 select-none" style={{ color: "var(--text-muted)" }}>
                    L{match.line}
                  </span>
                  <span className="text-xs leading-relaxed flex-1" style={{ color: "var(--text-subtle)" }}>
                    {semantic ? match.text : highlightSearchText(match.text, query)}
                  </span>
                </div>
              ))}
              {file.matches.length > 5 ? (
                <Link href={href} className="text-xs mt-1 inline-block" style={{ color: "var(--accent)" }}>
                  +{file.matches.length - 5} more match{file.matches.length - 5 !== 1 ? "es" : ""}
                </Link>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
