import { z } from "zod";
import { defineAction } from "./define.ts";

export interface NoteAssetReader {
  readAsset: (path: string) => Uint8Array | null;
  normalize: (path: string) => string;
}

export interface NoteAssetReadResult {
  path: string;
  data: Uint8Array | null;
}

const noteAssetReadInput = z.object({ path: z.string() });

export const noteAssetRead = defineAction<typeof noteAssetReadInput, NoteAssetReader, NoteAssetReadResult>({
  input: noteAssetReadInput,
  http: { method: "GET", path: "/api/notes-assets/[...path]" },
  mcp: { reason: "MCP has no binary asset read tool." },
  handler: ({ path }, storage) => {
    const normalized = storage.normalize(path);
    return { path: normalized, data: storage.readAsset(normalized) };
  },
});

export interface NoteAssetWriter {
  writeAsset: (path: string, data: Uint8Array) => { path: string; size: number };
  decodeBase64: (content: string) => Uint8Array;
}

export type NoteAssetWriteResult = { file: { path: string; size: number } } | { error: string };

const noteAssetWriteInput = z.object({
  path: z.string().describe("Notes-relative asset path (must not end in .json). Allowed: jpg, jpeg, png, gif, webp"),
  contentBase64: z.string().describe("Base64-encoded file bytes"),
  mimeType: z.string().optional().describe("Optional MIME hint (ignored if extension is valid)"),
}).meta({ additionalProperties: false });

export const noteAssetWrite = defineAction<typeof noteAssetWriteInput, NoteAssetWriter, NoteAssetWriteResult>({
  input: noteAssetWriteInput,
  http: { reason: "Binary asset writes are MCP-only." },
  mcp: { name: "notes_write_asset", toolset: "notes", description: "Write a binary image asset under the notes tree (e.g. garden/my-project/assets/photo-1.jpg). Use before notes_write when embedding photos via ![caption](path) markdown." },
  handler: ({ path, contentBase64 }, storage) => {
    let data: Uint8Array;
    try {
      data = storage.decodeBase64(contentBase64);
    } catch {
      return { error: "Invalid base64 content" };
    }
    if (data.length === 0) return { error: "Empty asset content" };
    try {
      return { file: storage.writeAsset(path, data) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not write asset" };
    }
  },
});
