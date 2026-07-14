import { NextRequest, NextResponse } from "next/server";
import { lexicalSearchNotes } from "@shared/notes-search/lexical.ts";
import { withErrorHandler } from "@/lib/api-utils";
import { getVaultStorage, parseVaultId } from "@/lib/vault/vault-registry";
import type { TextSearchResult } from "@/lib/vault/vault-storage";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Query parameter 'q' required" }, { status: 400 });

  const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
  if (prefix && (prefix.includes("..") || prefix.startsWith("/"))) {
    return NextResponse.json({ error: "Invalid prefix" }, { status: 400 });
  }

  const mode = req.nextUrl.searchParams.get("mode");
  const vaultId = parseVaultId(req.nextUrl.searchParams.get("vault"));

  // mode=semantic kept as alias — implementation is lexical TF-IDF, not embeddings.
  if ((mode === "semantic" || mode === "ranked" || mode === "lexical") && vaultId === "notes") {
    const storage = getVaultStorage("notes");
    const ranked = lexicalSearchNotes(storage.root, q, { includeTldraw: true });
    const filtered = prefix ? ranked.filter((r) => r.path.startsWith(prefix)) : ranked;
    return NextResponse.json({
      query: q,
      vault: vaultId,
      mode: "semantic",
      ranking: "lexical-tfidf",
      total: filtered.length,
      files: filtered.map((r) => ({
        path: r.path,
        score: r.score,
        matches: [{ line: 1, text: r.preview }],
      })),
    });
  }

  const allResults = getVaultStorage(vaultId).search(q);

  const results = prefix
    ? allResults.filter((r) => r.path.startsWith(prefix))
    : allResults;

  const grouped: Record<string, typeof results> = {};
  for (const r of results) {
    if (!grouped[r.path]) grouped[r.path] = [];
    grouped[r.path].push(r);
  }

  const files =
    vaultId === "docs"
      ? Object.entries(grouped).map(([path, matches]) => {
          const docMatches = matches as TextSearchResult[];
          return {
            path,
            matches: docMatches.map((m) => ({ line: m.line, text: m.text })),
            score:
              docMatches.reduce((sum, m) => sum + m.score, 0) +
              (docMatches[0]?.line === 1 ? 50 : 0),
          };
        })
      : Object.entries(grouped).map(([path, matches]) => ({
          path,
          matches,
          score: matches.length * 10 + (matches[0]?.line === 1 ? 50 : 0),
        }));

  files.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    query: q,
    vault: vaultId,
    total: results.length,
    files,
  });
}, "search");
