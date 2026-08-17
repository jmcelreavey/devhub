/**
 * Index build and persistence.
 *
 * The index is a cache. That is a design constraint, not a disclaimer:
 *  - every chunk carries `sourceId`, so any hit can be traced to a real file;
 *  - the whole directory is gitignored and safe to delete at any time;
 *  - a version or embedder change discards it rather than migrating it.
 *
 * The in-process memo is what makes the API route cheap: Next keeps the module
 * alive between requests, so a query after the first pays only the vector
 * comparison, not the disk read and BM25 construction.
 */
import fs from "node:fs";
import path from "node:path";
import { writeAtomicNow, safeReadJSON } from "@/lib/atomic-write";
import { Bm25Index } from "./bm25";
import { buildCorpus, sourcesNewestMtime, type BuildCorpusOptions } from "./corpus";
import { dequantise, getEmbedder, quantise } from "./embed";
import { chunksFile, indexDir, manifestFile, RECALL_INDEX_VERSION } from "./paths";
import { tokenize } from "./tokenize";
import type { RecallChunk, RecallIndexManifest } from "./types";

interface StoredChunk extends RecallChunk {
  /** int8-quantised embedding. */
  v: number[];
}

interface StoredIndex {
  version: number;
  chunks: StoredChunk[];
}

/** Everything a query needs, assembled once and reused. */
export interface LoadedIndex {
  manifest: RecallIndexManifest;
  chunks: RecallChunk[];
  vectors: Map<string, Float32Array>;
  bm25: Bm25Index;
}

let memo: { key: string; index: LoadedIndex } | null = null;

function memoKey(manifest: RecallIndexManifest): string {
  return `${manifest.builtAt}:${manifest.chunkCount}:${manifest.embedder}`;
}

export function readManifest(): RecallIndexManifest | null {
  const manifest = safeReadJSON<RecallIndexManifest | null>(manifestFile(), null);
  if (!manifest || manifest.version !== RECALL_INDEX_VERSION) return null;
  return manifest;
}

/**
 * Build the index from scratch and write it.
 *
 * Always a full rebuild. Incremental indexing was considered and dropped: the
 * measured full build is fast enough that the bookkeeping to make it partial
 * would be the larger source of bugs, and a partially-stale index is a much
 * worse failure mode than a slow rebuild — it returns confidently wrong
 * results with no signal that anything is off. `loadIndex()` calls `isStale()`
 * so the cheap half of that idea is automatic: skip when current, rebuild when
 * sources have moved.
 */
export function buildIndex(options: BuildCorpusOptions = {}): RecallIndexManifest {
  const startedAt = Date.now();
  const embedder = getEmbedder();
  const chunks = buildCorpus(options);

  const stored: StoredChunk[] = chunks.map((chunk) => ({
    ...chunk,
    // Title is embedded alongside the body so a chunk whose heading names the
    // topic still matches when the prose never repeats it.
    v: quantise(embedder.embed(`${chunk.title}\n${chunk.text}`)),
  }));

  const bySource: Record<string, number> = {};
  for (const chunk of chunks) {
    bySource[chunk.sourceKind] = (bySource[chunk.sourceKind] ?? 0) + 1;
  }

  const manifest: RecallIndexManifest = {
    version: RECALL_INDEX_VERSION,
    builtAt: new Date().toISOString(),
    chunkCount: chunks.length,
    bySource,
    dims: embedder.dims,
    embedder: embedder.id,
    tookMs: Date.now() - startedAt,
  };

  fs.mkdirSync(indexDir(), { recursive: true });
  const payload: StoredIndex = { version: RECALL_INDEX_VERSION, chunks: stored };
  writeAtomicNow(chunksFile(), JSON.stringify(payload));
  writeAtomicNow(manifestFile(), JSON.stringify(manifest, null, 2));
  writeGitignore();

  memo = null;
  return manifest;
}

/**
 * Keep the derived index out of git without asking the user to edit
 * `.gitignore`. A self-ignoring cache directory is the only way "delete it
 * freely" stays true — otherwise the first `git status` after a build shows a
 * few thousand lines of noise and someone commits it.
 */
function writeGitignore(): void {
  try {
    const file = path.join(indexDir(), ".gitignore");
    if (!fs.existsSync(file)) writeAtomicNow(file, "*\n");
  } catch {
    // Cosmetic. A failure here must never fail a build.
  }
}

/** True when the index is missing, stale by version/embedder, or older than the sources. */
export function isStale(): boolean {
  const manifest = readManifest();
  if (!manifest) return true;
  if (manifest.embedder !== getEmbedder().id) return true;
  if (!fs.existsSync(chunksFile())) return true;
  return sourcesNewestMtime() > Date.parse(manifest.builtAt);
}

/** Load the index, rebuilding when missing or stale. Returns null if it can't be built. */
export function loadIndex(options: { autoBuild?: boolean } = {}): LoadedIndex | null {
  const { autoBuild = true } = options;

  if (autoBuild && isStale()) {
    buildIndex();
  }

  const manifest = readManifest();
  if (!manifest) return null;

  const key = memoKey(manifest);
  if (memo && memo.key === key) return memo.index;

  const payload = safeReadJSON<StoredIndex | null>(chunksFile(), null);
  if (!payload || !Array.isArray(payload.chunks)) return null;

  const vectors = new Map<string, Float32Array>();
  const chunks: RecallChunk[] = [];
  const bm25 = new Bm25Index();

  for (const stored of payload.chunks) {
    const { v, ...chunk } = stored;
    chunks.push(chunk);
    vectors.set(chunk.id, dequantise(v ?? []));
    bm25.add({ id: chunk.id, tokens: tokenize(`${chunk.title}\n${chunk.text}`) });
  }

  const index: LoadedIndex = { manifest, chunks, vectors, bm25 };
  memo = { key, index };
  return index;
}

/** Drop the process-local memo. Not a rebuild — the next `loadIndex()` decides that. */
export function invalidateMemo(): void {
  memo = null;
}

/** Delete the derived index. The event spine is untouched — it isn't derived. */
export function clearIndex(): void {
  memo = null;
  for (const file of [chunksFile(), manifestFile()]) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file);
    } catch {
      // Best effort; a locked file just means the next build overwrites it.
    }
  }
}
