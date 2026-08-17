import { hasVisibleDiagramShapes } from "@/lib/diagram-utils";

/**
 * In-memory request cache for diagram card previews.
 *
 * The folder grid used to GET the full tldraw JSON per card. There is no
 * thumbnail field on the diagram schema, so we cache a cheap server snapshot
 * (`empty` vs `{ store }`) keyed by path + mtime and coalesce in-flight work.
 */

export interface DiagramPreview {
  empty: boolean;
  /** Present when the diagram has visible shapes — the tldraw `store` field. */
  store?: Record<string, unknown>;
}

/** Pure: turn persisted tldraw JSON into a small card preview. */
export function previewFromDiagramContent(content: unknown): DiagramPreview {
  if (!content || typeof content !== "object") return { empty: true };
  const record = content as Record<string, unknown>;
  const store = record.store;
  if (!store || typeof store !== "object") return { empty: true };
  const snapshot = store as Record<string, unknown>;
  if (!hasVisibleDiagramShapes(snapshot)) return { empty: true };
  return { empty: false, store: snapshot };
}

interface CacheEntry {
  mtime: number | undefined;
  preview: DiagramPreview;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DiagramPreview>>();

export function peekDiagramPreview(path: string, mtime?: number): DiagramPreview | undefined {
  const hit = cache.get(path);
  if (!hit) return undefined;
  if (mtime !== undefined && hit.mtime !== undefined && hit.mtime !== mtime) return undefined;
  return hit.preview;
}

export function rememberDiagramPreview(path: string, preview: DiagramPreview, mtime?: number): void {
  cache.set(path, { mtime, preview });
}

export function invalidateDiagramPreview(path: string): void {
  cache.delete(path);
  inflight.delete(path);
}

/** Test helper. */
export function clearDiagramPreviewCache(): void {
  cache.clear();
  inflight.clear();
}

async function fetchPreviews(paths: string[]): Promise<Record<string, DiagramPreview>> {
  const res = await fetch("/api/diagrams/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) return {};
  const body = (await res.json().catch(() => ({}))) as { previews?: Record<string, DiagramPreview> };
  return body.previews ?? {};
}

export async function prefetchDiagramPreviews(
  files: Array<{ path: string; modified?: number }>,
): Promise<void> {
  const missing = files.filter((f) => peekDiagramPreview(f.path, f.modified) === undefined);
  if (missing.length === 0) return;

  const unique = [...new Map(missing.map((f) => [f.path, f])).values()];
  const fetched = unique.filter((f) => inflight.has(f.path));
  const toFetch = unique.filter((f) => !inflight.has(f.path));

  let batch: Promise<Record<string, DiagramPreview>> | undefined;
  if (toFetch.length > 0) {
    batch = fetchPreviews(toFetch.map((f) => f.path));
    for (const f of toFetch) {
      const pending = batch.then((previews) => {
        const preview = previews[f.path];
        if (preview) rememberDiagramPreview(f.path, preview, f.modified);
        inflight.delete(f.path);
        return preview ?? { empty: true };
      }).catch((err: unknown) => {
        inflight.delete(f.path);
        throw err;
      });
      inflight.set(f.path, pending);
    }
  }

  await Promise.all([
    batch,
    ...fetched.map((f) => inflight.get(f.path)),
  ]);
}

export async function loadDiagramPreview(path: string, mtime?: number): Promise<DiagramPreview> {
  const cached = peekDiagramPreview(path, mtime);
  if (cached) return cached;
  const pending = inflight.get(path);
  if (pending) return pending;
  await prefetchDiagramPreviews([{ path, modified: mtime }]);
  return peekDiagramPreview(path, mtime) ?? { empty: true };
}
