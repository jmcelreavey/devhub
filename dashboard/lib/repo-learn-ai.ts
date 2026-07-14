import { generateText } from "ai";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import {
  buildNotebookImportReadme,
  buildSnippetPackFiles,
  compactContextForModel,
  type RepoContext,
} from "@/lib/repo-context";
import type { RepoLearnPackFile } from "@/lib/repo-learn-cache";

import { GAP_EXPLAINED_MARKER } from "@/lib/repo-learn-tutor-utils";

const MAX_SNIPPET_CHARS_FOR_MODEL = 8_000;
const MAX_PACK_FILE_CHARS = 40_000;

export interface RepoLearnArtifacts {
  briefMarkdown: string;
  packFiles: RepoLearnPackFile[];
}

interface AiPackResponse {
  packSections: { path: string; content: string }[];
}

export function buildBriefPrompt(context: RepoContext): string {
  const facts = JSON.stringify(compactContextForModel(context), null, 2);
  const excerpts = formatSnippetsForPrompt(context.snippets.slice(0, 5));

  return [
    `You are writing an onboarding brief for the "${context.repoName}" repository.`,
    "Use ONLY the repo facts and excerpts below. Do not invent file paths, commands, or architecture.",
    'If something is unknown, say "not detected" instead of guessing.',
    "Cite file paths from the provided lists when referencing specific files.",
    "",
    "Write markdown with these sections:",
    "## What this repo is",
    "## How to run and verify",
    "## Architecture map",
    "## Reading path",
    "## Gotchas",
    "",
    "Repo facts (JSON):",
    facts,
    "",
    "Source excerpts:",
    excerpts,
  ].join("\n");
}

export function buildPackPrompt(context: RepoContext): string {
  const facts = JSON.stringify(compactContextForModel(context), null, 2);
  const excerpts = formatSnippetsForPrompt(context.snippets.slice(0, 8));

  return [
    `You are building a NotebookLM source pack for "${context.repoName}".`,
    "Return ONLY valid JSON (no markdown fences) with this shape:",
    '{"packSections":[{"path":"00-overview.md","content":"..."},{"path":"01-architecture.md","content":"..."},...]}',
    "",
    "Required packSections paths (markdown content for each):",
    "- 00-overview.md — executive summary",
    "- 01-architecture.md — modules, entry points, data flow with file/path refs from facts",
    "- 02-commands-and-setup.md — run, test, build, deploy",
    "- 03-recent-changes.md — commit themes and what to watch",
    "- 04-decisions-and-gotchas.md — tradeoffs from README/AGENTS.md/manifests",
    "",
    "Rules:",
    "- Use ONLY paths and commands from the repo facts.",
    "- Keep each section under 8000 characters.",
    "- Do not include secrets or env values.",
    "",
    "Repo facts (JSON):",
    facts,
    "",
    "Source excerpts:",
    excerpts,
  ].join("\n");
}

export function buildTutorSystemPrompt(context: RepoContext): string {
  const facts = JSON.stringify(compactContextForModel(context), null, 2);
  const excerptSummary = context.snippets
    .slice(0, 6)
    .map((s) => `- ${s.relativePath} (${s.text.length} chars)`)
    .join("\n");

  return [
    `You are a Socratic tutor helping a developer learn the "${context.repoName}" codebase.`,
    "",
    "Pedagogy rules:",
    "1. Ask before explaining. Evaluate the developer's answer first.",
    "2. Escalate hints: open question → narrow → partial fact → full explanation only after a clear gap.",
    "3. One question at a time. Keep responses to 4–8 sentences unless explaining a knowledge gap.",
    "4. Never invent file paths. Cite only paths from the repo facts below. If unsure, say so.",
    "5. When you find a knowledge gap and explain it, end your message with the exact marker:",
    `   ${GAP_EXPLAINED_MARKER}`,
    "6. After explaining a gap, ask a follow-up that connects to an adjacent concept.",
    "7. Calibrate difficulty: if they answer well, go deeper; if they struggle, simplify.",
    "",
    "Repo facts (JSON):",
    facts,
    "",
    "Available source files:",
    excerptSummary || "No excerpts scanned.",
  ].join("\n");
}

export async function generateRepoLearnArtifacts(context: RepoContext): Promise<RepoLearnArtifacts> {
  const model = getNotesAiModel();
  if (!model) {
    throw new Error("AI_API_KEY is not set.");
  }

  const callOptions = getNotesAiCallOptions();

  const [briefResult, packResult] = await Promise.all([
    generateText({
      model,
      prompt: buildBriefPrompt(context),
      ...callOptions,
    }),
    generateText({
      model,
      prompt: buildPackPrompt(context),
      maxOutputTokens: 4096,
      ...callOptions,
    }),
  ]);

  const briefMarkdown = briefResult.text.trim();
  if (!briefMarkdown) {
    throw new Error(`Brief generation returned empty (finish: ${briefResult.finishReason}).`);
  }
  if (briefResult.finishReason === "length") {
    console.warn("[repo-learn-ai] Brief generation truncated; using partial brief.");
  }

  const packSections = parsePackSections(packResult.text);
  if (packResult.finishReason === "length") {
    console.warn("[repo-learn-ai] Pack generation truncated; using partial sections.");
  }
  const readme: RepoLearnPackFile = {
    path: "README-import.md",
    content: buildNotebookImportReadme(context.repoName),
  };
  const snippetFiles = buildSnippetPackFiles(context.snippets);
  const packFiles = [readme, ...packSections, ...snippetFiles].map(trimPackFile);

  return { briefMarkdown, packFiles };
}

export function parsePackSections(raw: string): RepoLearnPackFile[] {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(jsonText) as AiPackResponse;
    if (!Array.isArray(parsed.packSections)) return [];
    return parsed.packSections
      .filter((s) => s.path && s.content)
      .map((s) => ({ path: s.path, content: s.content }));
  } catch {
    return [
      {
        path: "00-overview.md",
        content: raw.trim() || "# Overview\n\nPack generation could not be parsed; see brief instead.",
      },
    ];
  }
}

function formatSnippetsForPrompt(snippets: RepoContext["snippets"]): string {
  let remaining = MAX_SNIPPET_CHARS_FOR_MODEL;
  const parts: string[] = [];
  for (const snippet of snippets) {
    if (remaining <= 0) break;
    const text = snippet.text.slice(0, Math.min(4_000, remaining));
    parts.push(`### ${snippet.relativePath}\n${text}`);
    remaining -= text.length;
  }
  return parts.join("\n\n") || "(no excerpts)";
}

function trimPackFile(file: RepoLearnPackFile): RepoLearnPackFile {
  if (file.content.length <= MAX_PACK_FILE_CHARS) return file;
  return {
    path: file.path,
    content: `${file.content.slice(0, MAX_PACK_FILE_CHARS)}\n\n…(truncated)`,
  };
}
