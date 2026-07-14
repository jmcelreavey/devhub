import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { researchDir } from "@/lib/briefing-research";
import { resolveLast30DaysScript } from "@/lib/last30days-runner";

export const GET = withErrorHandler(async () => {
  const dir = researchDir();
  const files: { name: string; path: string; mtimeMs: number; size: number }[] = [];
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) continue;
        files.push({
          name,
          path: path.relative(process.cwd(), abs),
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      } catch {
        /* skip */
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Surface research markdown/json files as lightweight cards
  const fileCards = files.slice(0, 40).map((f) => {
    let preview = "";
    try {
      const abs = path.join(dir, f.name);
      preview = fs.readFileSync(abs, "utf-8").slice(0, 400);
    } catch {
      /* ignore */
    }
    return {
      interest: f.name.replace(/\.(md|json|txt)$/i, ""),
      title: f.name,
      summary: preview.replace(/\s+/g, " ").slice(0, 220),
      updatedAt: new Date(f.mtimeMs).toISOString(),
      sourcePath: f.name,
      signals: [],
    };
  });

  return NextResponse.json({
    script: resolveLast30DaysScript(),
    researchDir: dir,
    files,
    cards: fileCards,
  });
}, "research/list");
