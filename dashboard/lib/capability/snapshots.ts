/**
 * Capability Radar — snapshot store.
 *
 * Each aggregate scan is persisted as a dated JSON file so runs are comparable
 * over time. Layout under the notes cache dir:
 *
 *   notes/.cache/capability/snapshots/<id>.json   one per scan (id = sortable)
 *   notes/.cache/capability/repos/<repo>.json     last per-repo scan (adaptive skip)
 *
 * Snapshot ids are the ISO timestamp with unsafe chars stripped, so lexical
 * sort == chronological sort.
 */

import fs from "node:fs";
import path from "node:path";
import { safeReadJSON, writeAtomic } from "@/lib/atomic-write";
import { capabilityCacheDir, safeSegment } from "./paths";
import type { CapabilitySnapshot, RepoScan } from "./types";

function snapshotsDir(): string {
  return capabilityCacheDir("snapshots");
}
function reposDir(): string {
  return capabilityCacheDir("repos");
}

export function snapshotIdFromDate(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function safeRepoFile(repoName: string): string {
  return path.join(reposDir(), `${safeSegment(repoName)}.json`);
}

/** Persist a snapshot and return it. */
export async function writeSnapshot(snapshot: CapabilitySnapshot): Promise<CapabilitySnapshot> {
  const file = path.join(snapshotsDir(), `${snapshot.id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify(snapshot));
  return snapshot;
}

function listSnapshotIds(): string[] {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort(); // lexical == chronological
}

export function readSnapshot(id: string): CapabilitySnapshot | null {
  return safeReadJSON<CapabilitySnapshot | null>(path.join(snapshotsDir(), `${id}.json`), null);
}

/** Newest snapshot, or null if none yet. */
export function readLatestSnapshot(): CapabilitySnapshot | null {
  const ids = listSnapshotIds();
  const last = ids[ids.length - 1];
  return last ? readSnapshot(last) : null;
}

/** The snapshot immediately before `id` (chronologically), or null. */
export function readPreviousSnapshot(id: string): CapabilitySnapshot | null {
  const ids = listSnapshotIds();
  const idx = ids.indexOf(id);
  if (idx <= 0) return null;
  return readSnapshot(ids[idx - 1]);
}

export function listSnapshotsMeta(): { id: string; createdAt: string; repoCount: number }[] {
  return listSnapshotIds()
    .map((id) => readSnapshot(id))
    .filter((s): s is CapabilitySnapshot => s !== null)
    .map((s) => ({ id: s.id, createdAt: s.createdAt, repoCount: s.repoCount }));
}

// --- per-repo cache (adaptive remote probing) ---

export interface RepoScanCache {
  repoName: string;
  sha: string | null;
  scannedAt: string;
  scan: RepoScan;
}

export function readRepoScanCache(repoName: string): RepoScanCache | null {
  return safeReadJSON<RepoScanCache | null>(safeRepoFile(repoName), null);
}

export async function writeRepoScanCache(entry: RepoScanCache): Promise<void> {
  const file = safeRepoFile(entry.repoName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify(entry));
}

/** True when a cached scan exists for this exact SHA (unchanged → can skip). */
export function repoUnchanged(repoName: string, sha: string | null): boolean {
  if (!sha) return false;
  const cached = readRepoScanCache(repoName);
  return cached?.sha === sha;
}
