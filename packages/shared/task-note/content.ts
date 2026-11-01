import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ContentConflictError, type ContentStorage } from "../storage/content.ts";
import { IMPORT_LOCAL_ASSET_MAX_BYTES, isAllowedNoteAssetExtension } from "../notes-assets/server.ts";
import { jsonVaultCodec } from "../vault/vault-codec.ts";
import { TaskNoteOpError } from "./sections.ts";
import { normalizeTaskNotePath, updateTaskNote, type UpdateTaskNoteOptions } from "./update.ts";

async function importTaskNoteAsset(storage: ContentStorage, notePath: string, localFile: string): Promise<string> {
  if (!path.isAbsolute(localFile)) throw new TaskNoteOpError("localFile must be an absolute path");
  const real = fs.realpathSync(localFile);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new TaskNoteOpError("localFile is not a file");
  const name = path.basename(real);
  if (!isAllowedNoteAssetExtension(name)) throw new TaskNoteOpError("Unsupported asset type");
  if (stat.size > IMPORT_LOCAL_ASSET_MAX_BYTES) throw new TaskNoteOpError(`File is larger than ${IMPORT_LOCAL_ASSET_MAX_BYTES / 1024 / 1024} MB`);
  const data = fs.readFileSync(real);
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 10);
  const relative = `task-notes/assets/${path.posix.basename(notePath)}/${hash}-${name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
  const current = await storage.assets.read(relative);
  if (!current || !current.content.equals(data)) await storage.assets.write(relative, data, current?.revision ?? null);
  return relative;
}

/** Run the existing section transform against a revision and commit it once. */
export async function updateTaskNoteContent(storage: ContentStorage, rawPath: string, fields: Record<string, unknown>, options: UpdateTaskNoteOptions) {
  const target = normalizeTaskNotePath(rawPath);
  const file = await storage.read(target + ".json");
  const existing = file ? { ...file, content: jsonVaultCodec.parse(file.content.toString("utf8")) } : null;
  let normalizedFields = fields;
  if (fields.op === "add_media" && typeof fields.localFile === "string" && fields.localFile) {
    try {
      const assetPath = await importTaskNoteAsset(storage, target, fields.localFile);
      normalizedFields = { ...fields, localFile: undefined, assetPath, url: undefined };
    } catch (error) {
      if (error instanceof ContentConflictError) throw error;
      throw new TaskNoteOpError(error instanceof Error ? error.message : "Could not import localFile");
    }
  }
  let updated: unknown;
  const result = updateTaskNote({
    read: () => existing,
    write: (_path, blocks) => { updated = blocks; },
  }, target, normalizedFields, options);
  if (updated !== undefined) await storage.write(target + ".json", jsonVaultCodec.serialize(updated), file?.revision ?? null);
  return result;
}
