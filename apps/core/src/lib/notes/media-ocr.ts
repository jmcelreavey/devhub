import fs from "node:fs/promises";
import path from "node:path";
import { VISION_OCR_SOURCE } from "./vision-ocr-source";
import { execExternal } from "../exec-external";
import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content";
import { withPluginMutationLock, PluginBusyError } from "../plugins/lock";
import { isNoteMediaName, noteMediaDir, noteMediaUrl, readNoteMedia } from "./media-store";
import { emitCoreEvent } from "../../domains/events/core-events";

interface OcrRecord {
  version: 1;
  name: string;
  status: "ready" | "failed" | "unavailable";
  text: string;
  error?: string;
  indexedAt: string;
}
const globalStore = globalThis as typeof globalThis & { __devhubMediaOcr?: { queue: Set<string>; running: boolean } };
const state = globalStore.__devhubMediaOcr ??= { queue: new Set<string>(), running: false };
const queue = state.queue;
const indexDir = () => path.join(noteMediaDir(), ".ocr-v1");

async function recordFor(name: string): Promise<OcrRecord | null> {
  try { return JSON.parse(await fs.readFile(path.join(indexDir(), name + ".json"), "utf8")) as OcrRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function queueMediaOcr(name: string, retry = false): Promise<void> {
  if (!isNoteMediaName(name) || (!retry && await recordFor(name))) return;
  if (queue.size >= 200) return;
  queue.add(name);
  emitCoreEvent("media");
  void drain();
}

async function drain(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    for (const name of queue) {
      queue.delete(name);
      emitCoreEvent("media");
      try {
        await withPluginMutationLock(indexDir(), async () => {
          const storage = createFileContentStorage(noteMediaDir(), { fileMode: 0o600, dirMode: 0o700 });
          const save = async (file: string, content: string) => {
            const current = await storage.read(file);
            await storage.write(file, content, current?.revision ?? null);
          };
          const record: OcrRecord = { version: 1, name, status: "ready", text: "", indexedAt: new Date().toISOString() };
          try {
            const bytes = readNoteMedia(name);
            if (!bytes) throw new Error("Image is missing.");
            if (process.platform !== "darwin") {
              record.status = "unavailable";
              record.error = "Local OCR currently requires macOS with Swift command-line tools.";
            } else {
              const helper = path.join(indexDir(), "ocr.swift");
              await save(".ocr-v1/ocr.swift", VISION_OCR_SOURCE);
              const result = await execExternal("swift", [helper], {
                input: bytes, timeoutMs: 15_000, maxBuffer: 256_000, label: "notes-media:ocr",
              });
              record.text = result.stdout.trim().slice(0, 100_000);
            }
          } catch (error) {
            record.status = "failed";
            record.error = error instanceof Error ? error.message.slice(0, 300) : "Text recognition failed.";
          }
          await save(`.ocr-v1/${name}.json`, JSON.stringify(record));
        }, { waitMs: 100 });
      } catch (error) {
        // Another DevHub instance may be doing the same derived work.
        if (!(error instanceof PluginBusyError)) console.error("Screenshot indexing failed", error);
      }
    }
  } finally { state.running = false; emitCoreEvent("media"); }
}

export async function mediaOcrSearch(query: string) {
  const names = (await fs.readdir(noteMediaDir()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter(isNoteMediaName);
  const records: OcrRecord[] = [];
  for (const name of names) {
    const record = await recordFor(name);
    if (record) records.push(record);
  }
  const q = query.trim().toLocaleLowerCase();
  const matches = q ? records.filter(record => record.status === "ready" && record.text.toLocaleLowerCase().includes(q)) : [];
  return {
    total: names.length, indexed: records.filter(record => record.status === "ready").length,
    failed: records.filter(record => record.status === "failed").length,
    unavailable: records.filter(record => record.status === "unavailable").length,
    queued: queue.size + Number(state.running),
    matches: matches.slice(0, 50).map(record => {
      const offset = record.text.toLocaleLowerCase().indexOf(q);
      return { name: record.name, url: noteMediaUrl(record.name), snippet: record.text.slice(Math.max(0, offset - 80), offset + q.length + 180) };
    }),
    truncated: matches.length > 50,
  };
}

export async function indexStoredMedia(): Promise<number> {
  const names = (await fs.readdir(noteMediaDir()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter(isNoteMediaName);
  let count = 0;
  for (const name of names) {
    const record = await recordFor(name);
    if (record?.status === "ready") continue;
    await queueMediaOcr(name, true);
    if (++count >= 200) break;
  }
  return count;
}
