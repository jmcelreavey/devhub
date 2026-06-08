import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import {
  IDENTITY_MARKER_END,
  IDENTITY_MARKER_START,
  MARKER_END,
  MARKER_START,
  PERSONA_SOURCE_META,
  type PersonaSourceId,
  estimatePersonaTokens,
  extractPersonaBlock,
} from "@/lib/persona-meta";

export const dynamic = "force-dynamic";

interface PersonaTarget {
  id: string;
  label: string;
  /** Path relative to repo root, or absolute (for ~/.claude etc). */
  filepath: string;
  description: string;
  /** "source" files are hand-edited; sync reads these and writes marker blocks.
   *  "synced" files are build output from sync_native_persona. */
  kind: "source" | "synced";
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(2));
  return p;
}

function resolveTarget(t: PersonaTarget): string {
  if (path.isAbsolute(t.filepath) || t.filepath.startsWith("~/")) {
    return expandHome(t.filepath);
  }
  return path.join(getRepoRoot(), t.filepath);
}

function deepPreferencesTokenEstimate(repoRoot: string): number {
  let total = 0;
  const indexPath = path.join(repoRoot, "persona", "deep-preferences.md");
  if (fs.existsSync(indexPath)) {
    total += estimatePersonaTokens(fs.readFileSync(indexPath, "utf-8"));
  }
  const modesDir = path.join(repoRoot, "persona", "modes");
  if (!fs.existsSync(modesDir)) return total;
  for (const name of fs.readdirSync(modesDir)) {
    if (!name.endsWith(".md")) continue;
    total += estimatePersonaTokens(
      fs.readFileSync(path.join(modesDir, name), "utf-8"),
    );
  }
  return total;
}

const TARGETS: PersonaTarget[] = [
  {
    id: "shared-persona",
    label: "Shared persona (engineering standards)",
    filepath: "persona/shared-persona.md",
    description:
      "L1 — core engineering standards loaded every session (~685 tokens). " +
      "Synced into marker blocks in Claude, Codex, OpenCode, Cursor, and repo AGENTS.md.",
    kind: "source",
  },
  {
    id: "identity",
    label: "Identity / personality",
    filepath: "persona/identity.txt",
    description:
      "L0 — tone, role, and how to work with you (~200 tokens). " +
      "Synced everywhere including repo AGENTS.md. Keep this file small.",
    kind: "source",
  },
  {
    id: "deep-preferences",
    label: "Deep preferences (load on demand)",
    filepath: "persona/deep-preferences.md",
    description:
      "L2 — index for context-specific modes under persona/modes/. " +
      "Not synced. Use the deep-preferences skill to load only the matching mode file(s).",
    kind: "source",
  },
  {
    id: "agents",
    label: "AGENTS.md — repo root",
    filepath: "AGENTS.md",
    description: "Build output: identity + shared-persona marker blocks.",
    kind: "synced",
  },
  {
    id: "claude",
    label: "Claude — ~/.claude/CLAUDE.md",
    filepath: "~/.claude/CLAUDE.md",
    description: "Build output from persona sources.",
    kind: "synced",
  },
  {
    id: "codex",
    label: "Codex — ~/.codex/AGENTS.md",
    filepath: "~/.codex/AGENTS.md",
    description: "Build output from persona sources.",
    kind: "synced",
  },
  {
    id: "opencode",
    label: "OpenCode — ~/.opencode/AGENTS.md",
    filepath: "~/.opencode/AGENTS.md",
    description: "Build output from persona sources.",
    kind: "synced",
  },
  {
    id: "cursor",
    label: "Cursor — ~/.cursor/.cursorrules",
    filepath: "~/.cursor/.cursorrules",
    description: "Legacy Cursor rules file (marker injection).",
    kind: "synced",
  },
  {
    id: "cursor-rules-identity",
    label: "Cursor rule — devhub-persona-identity.mdc",
    filepath: "~/.cursor/rules/devhub-persona-identity.mdc",
    description: "Cursor always-on rule for L0 identity.",
    kind: "synced",
  },
  {
    id: "cursor-rules-shared",
    label: "Cursor rule — devhub-persona-shared.mdc",
    filepath: "~/.cursor/rules/devhub-persona-shared.mdc",
    description: "Cursor always-on rule for L1 shared persona.",
    kind: "synced",
  },
];

function excerpt(text: string | null, max = 280): string | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const repoRoot = getRepoRoot();

  if (!id) {
    const items = TARGETS.map((t) => {
      const resolved = resolveTarget(t);
      let exists = false;
      let modified: number | null = null;
      let tokenEstimate: number | null = null;
      try {
        const stat = fs.statSync(resolved);
        exists = true;
        modified = stat.mtimeMs;
        if (t.kind === "source") {
          if (t.id === "deep-preferences") {
            tokenEstimate = deepPreferencesTokenEstimate(repoRoot);
          } else {
            tokenEstimate = estimatePersonaTokens(
              fs.readFileSync(resolved, "utf-8"),
            );
          }
        }
      } catch {
        /* missing */
      }

      const meta =
        t.kind === "source"
          ? PERSONA_SOURCE_META[t.id as PersonaSourceId]
          : undefined;

      let sourceContent: string | undefined;
      if (t.kind === "source" && exists) {
        sourceContent = fs.readFileSync(resolved, "utf-8");
      }

      let identityExcerpt: string | null = null;
      let sharedExcerpt: string | null = null;
      if (t.kind === "synced" && exists) {
        const raw = fs.readFileSync(resolved, "utf-8");
        identityExcerpt = excerpt(
          extractPersonaBlock(raw, IDENTITY_MARKER_START, IDENTITY_MARKER_END),
        );
        sharedExcerpt = excerpt(
          extractPersonaBlock(raw, MARKER_START, MARKER_END),
        );
        if (!identityExcerpt && !sharedExcerpt && t.id.startsWith("cursor-rules")) {
          const body = raw.replace(/^---[\s\S]*?---\n*/m, "").trim();
          sharedExcerpt = excerpt(body);
        }
      }

      return {
        ...t,
        resolved,
        exists,
        modified,
        tokenEstimate,
        meta,
        sourceContent,
        identityExcerpt,
        sharedExcerpt,
      };
    });
    return NextResponse.json({ targets: items });
  }

  const target = TARGETS.find((t) => t.id === id);
  if (!target) return NextResponse.json({ error: "Unknown target" }, { status: 404 });
  const resolved = resolveTarget(target);
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ id, content: "", exists: false });
  }
  const content = fs.readFileSync(resolved, "utf-8");
  const stat = fs.statSync(resolved);
  return NextResponse.json({ id, content, exists: true, modified: stat.mtimeMs });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, content } = body as { id?: string; content?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (typeof content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const target = TARGETS.find((t) => t.id === id);
  if (!target || target.kind !== "source") {
    return NextResponse.json({ error: "Only source persona files are editable" }, { status: 400 });
  }
  const resolved = resolveTarget(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  const stat = fs.statSync(resolved);
  return NextResponse.json({ ok: true, id, modified: stat.mtimeMs });
}
