import { generateText } from "ai";
import { getNotesAiCallOptions, getNotesAiModel } from "@/lib/ai-provider";
import type { ScanFile } from "./detectors";
import type { DetectedSignal, SignalArea, SignalKind } from "./types";

const MAX_PATHS = 160;
const MAX_DEPS = 120;
const MAX_IMPORTS = 120;

const AREAS = new Set<SignalArea>(["runtime", "infra", "deploy", "data", "observability", "ci", "arch"]);
const KINDS = new Set<SignalKind>(["technology", "pattern", "concept"]);

interface AiSignalSuggestion {
  id?: string;
  label?: string;
  kind?: string;
  area?: string;
  evidence?: string[];
  match?: string;
}

interface RepoFacts {
  paths: Set<string>;
  dependencies: Map<string, string>;
  imports: Map<string, string>;
}

export async function enrichSignalsWithAi(files: ScanFile[], existing: DetectedSignal[]): Promise<DetectedSignal[]> {
  const model = getNotesAiModel();
  if (!model) return existing;

  const facts = collectFacts(files);
  if (facts.dependencies.size === 0 && facts.imports.size === 0) return existing;

  let raw: string;
  try {
    const result = await generateText({
      model,
      prompt: buildPrompt(facts, existing),
      maxOutputTokens: 1200,
      ...getNotesAiCallOptions(),
    });
    raw = result.text;
  } catch (error) {
    console.warn("[capability-ai] enrichment failed", error);
    return existing;
  }

  const suggestions = parseSuggestions(raw);
  if (suggestions.length === 0) return existing;

  const merged = new Map(existing.map((sig) => [sig.id, sig]));
  for (const suggestion of suggestions) {
    const sig = validateSuggestion(suggestion, facts);
    if (!sig || merged.has(sig.id)) continue;
    merged.set(sig.id, sig);
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export function collectFacts(files: ScanFile[]): RepoFacts {
  const paths = new Set(files.map((f) => f.path).slice(0, MAX_PATHS));
  const dependencies = new Map<string, string>();
  const imports = new Map<string, string>();

  for (const file of files) {
    if (!file.content) continue;
    if (file.base === "package.json") {
      for (const dep of parsePackageDeps(file.content).slice(0, MAX_DEPS - dependencies.size)) {
        dependencies.set(dep, file.path);
      }
    }
    if (file.ext === ".ts" || file.ext === ".tsx" || file.ext === ".js") {
      for (const mod of parseImports(file.content).slice(0, MAX_IMPORTS - imports.size)) {
        imports.set(mod, file.path);
      }
    }
  }

  return { paths, dependencies, imports };
}

function buildPrompt(facts: RepoFacts, existing: DetectedSignal[]): string {
  const payload = {
    paths: [...facts.paths],
    dependencies: [...facts.dependencies.keys()],
    imports: [...facts.imports.keys()],
    existingSignals: existing.map((s) => s.id),
  };

  return [
    "Identify missing Capability Radar signals from these compact repo facts.",
    "Return ONLY JSON: {\"signals\":[{\"id\":\"stable-kebab\",\"label\":\"Display name\",\"kind\":\"technology|pattern|concept\",\"area\":\"runtime|infra|deploy|data|observability|ci|arch\",\"evidence\":[\"path\"],\"match\":\"exact dependency/import/path token\"}]}",
    "Only include signals directly proven by a listed dependency, import, or path token. Do not infer from project purpose.",
    "Skip signals already present in existingSignals.",
    JSON.stringify(payload),
  ].join("\n");
}

function parseSuggestions(raw: string): AiSignalSuggestion[] {
  const text = extractJson(raw);
  try {
    const parsed = JSON.parse(text) as { signals?: AiSignalSuggestion[] };
    return Array.isArray(parsed.signals) ? parsed.signals.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function validateSuggestion(s: AiSignalSuggestion, facts: RepoFacts): DetectedSignal | null {
  if (!s.id || !s.label || !s.kind || !s.area || !s.match || !Array.isArray(s.evidence)) return null;
  if (!KINDS.has(s.kind as SignalKind) || !AREAS.has(s.area as SignalArea)) return null;
  const id = slug(s.id);
  if (!id || id.length > 60) return null;
  const token = s.match.toLowerCase();
  const evidence = s.evidence.filter((p) => facts.dependencies.get(token) === p || facts.imports.get(token) === p || p === s.match).slice(0, 4);
  if (evidence.length === 0) return null;
  if (!hasMatchedToken(s.match, facts)) return null;

  return {
    id,
    label: s.label.slice(0, 80),
    kind: s.kind as SignalKind,
    area: s.area as SignalArea,
    evidence,
    count: evidence.length,
    confidence: 0.68,
  };
}

function hasMatchedToken(match: string, facts: RepoFacts): boolean {
  const token = match.toLowerCase();
  return facts.dependencies.has(token) || facts.imports.has(token) || facts.paths.has(match);
}

function parsePackageDeps(content: string): string[] {
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const group = manifest[key];
      if (!group || typeof group !== "object") continue;
      for (const name of Object.keys(group)) deps.add(name.toLowerCase());
    }
    return [...deps];
  } catch {
    return [];
  }
}

function parseImports(content: string): string[] {
  const modules = new Set<string>();
  for (const match of content.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"'.][^"']*)["']/g)) {
    modules.add(match[1].toLowerCase());
  }
  return [...modules];
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
