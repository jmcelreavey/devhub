import { emitCoreEvent } from "../../domains/events/core-events";
import { blocksToText } from "../../../../../packages/shared/ui-lib/markdown-convert";
import { formatZodError, NotePutSchema } from "../schemas";
import { withErrorHandler } from "../api-utils";
import { getVault, getVaultStorage, type VaultId } from "./vault-registry";
import { mergeAgentEditsIntoTask } from "../notes/task-note-merge";
import { docsWrite } from "../../../../../packages/shared/actions/docs";
import { notesRename } from "../../../../../packages/shared/actions/notes";
import { isTaskNotePath } from "../../../../../packages/shared/task-note/sections";
import { ContentConflictError, type ContentFile } from "../../../../../packages/shared/storage/content";
import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content";
import { z } from "zod";

type Params = { params: Promise<{ path: string[] }> };

const writeSchema = NotePutSchema.extend({ expectedRevision: z.string().nullable().optional() });

function joinPath(segments: string[]): string {
  return segments.join("/");
}

function invalidateVault(vaultId: VaultId): void {
  emitCoreEvent(vaultId === "docs" ? "recall" : "notes");
}

function filePath(path: string, extension: string): string {
  return path.endsWith(extension) ? path : `${path}${extension}`;
}

function responseFile(file: ContentFile, vaultId: VaultId) {
  return {
    path: file.path,
    content: getVault(vaultId).codec.parse(file.content.toString("utf8")),
    modified: file.modified,
    size: file.size,
    revision: file.revision,
  };
}

function withConflictHandler(handler: (request: Request, params: Params) => Promise<Response>, label: string) {
  return withErrorHandler(async (request: Request, params: Params) => {
    try {
      return await handler(request, params);
    } catch (error) {
      if (error instanceof ContentConflictError) {
        return Response.json({ error: "This content changed elsewhere. Reload and try again." }, { status: 409 });
      }
      throw error;
    }
  }, label);
}

function matchesExpected(
  current: ContentFile | null,
  expectedRevision: string | null | undefined,
  expectedModified: number | null | undefined,
): boolean {
  if (expectedRevision !== undefined) return (current?.revision ?? null) === expectedRevision;
  if (expectedModified !== undefined) return expectedModified === null ? !current : current?.modified === expectedModified;
  return true;
}

export function createVaultRoutes(vaultId: VaultId) {
  const contentStorage = () => createFileContentStorage(getVault(vaultId).getRoot());
  const pathFor = (path: string) => filePath(path, getVault(vaultId).extension);

  const GET = withConflictHandler(async (_request, { params }) => {
    const file = await contentStorage().read(pathFor(joinPath((await params).path)));
    return file ? Response.json(responseFile(file, vaultId)) : Response.json({ error: "Not found" }, { status: 404 });
  }, `${vaultId}.get`);

  const write = async (request: Request, params: Params, createOnly: boolean) => {
    const path = joinPath((await params.params).path);
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = writeSchema.safeParse(body);
    if (!parsed.success || parsed.data.content === undefined) {
      return Response.json(
        { error: parsed.success ? "Content is required" : formatZodError(parsed.error) },
        { status: 400 },
      );
    }

    let content = parsed.data.content;
    if (vaultId === "docs") {
      const doc = docsWrite.input.safeParse({ path, content: Array.isArray(content) ? blocksToText(content) : content });
      if (!doc.success) return Response.json({ error: formatZodError(doc.error) }, { status: 400 });
      content = doc.data.content;
    }

    const storage = contentStorage();
    const resolvedPath = pathFor(path);
    const current = await storage.read(resolvedPath);
    if (createOnly && current) return Response.json({ error: "Already exists — use PUT to update" }, { status: 409 });
    if (!createOnly && current && parsed.data.expectedRevision === undefined && parsed.data.expectedModified === undefined) {
      return Response.json({ error: "Read this content before updating it and send expectedRevision." }, { status: 428 });
    }

    let merged: unknown[] | undefined;
    if (!createOnly && !matchesExpected(current, parsed.data.expectedRevision, parsed.data.expectedModified)) {
      const result = vaultId === "notes" && parsed.data.mergeAgentSections && current && isTaskNotePath(path) && Array.isArray(content)
        ? mergeAgentEditsIntoTask(responseFile(current, vaultId), content)
        : null;
      if (!result) return Response.json({ error: "This note changed elsewhere. Reload before saving." }, { status: 409 });
      content = result.blocks;
      merged = result.blocks;
    }
    const serialized = getVault(vaultId).codec.serialize(content);
    const written = await storage.write(resolvedPath, serialized, createOnly ? null : current?.revision ?? null);
    invalidateVault(vaultId);
    const file = responseFile(written, vaultId);
    return Response.json(merged ? { ...file, merged } : file, { status: createOnly ? 201 : 200 });
  };

  const PUT = withConflictHandler((request, params) => write(request, params, false), `${vaultId}.put`);

  const POST = withConflictHandler(async (request, params) => {
    const path = joinPath((await params.params).path);
    if (new URL(request.url).searchParams.get("dir") === "1") {
      if (!path) return Response.json({ error: "Folder path required" }, { status: 400 });
      const created = await contentStorage().createDirectory(path);
      invalidateVault(vaultId);
      return Response.json(created, { status: 201 });
    }
    return write(request, params, true);
  }, `${vaultId}.post`);

  const DELETE = withConflictHandler(async (request, { params }) => {
    const path = joinPath((await params).path);
    const url = new URL(request.url);
    const storage = contentStorage();
    const expectedRevision = url.searchParams.has("expectedRevision") ? url.searchParams.get("expectedRevision") : undefined;
    const expectedRaw = url.searchParams.get("expectedModified");
    const expectedModified = expectedRaw === null ? undefined : expectedRaw === "missing" ? null : Number(expectedRaw);
    if (expectedModified !== undefined && expectedModified !== null && (!Number.isFinite(expectedModified) || expectedModified < 0)) {
      return Response.json({ error: "Invalid expectedModified" }, { status: 400 });
    }
    if (url.searchParams.get("dir") === "1") {
      if (!path) return Response.json({ error: "Folder path required" }, { status: 400 });
      const current = await storage.readDirectory(path);
      if (expectedRevision !== undefined && (current?.revision ?? null) !== expectedRevision) throw new ContentConflictError(path);
      if (!current || !await storage.deleteDirectory(path, current.revision)) {
        return Response.json({ error: "Folder not found" }, { status: 404 });
      }
    } else {
      const resolvedPath = pathFor(path);
      const current = await storage.read(resolvedPath);
      if (!matchesExpected(current, expectedRevision, expectedModified)) throw new ContentConflictError(path);
      if (!current || !await storage.delete(resolvedPath, current.revision)) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    }
    invalidateVault(vaultId);
    return Response.json({ ok: true, path });
  }, `${vaultId}.delete`);

  const PATCH = withConflictHandler(async (request, { params }) => {
    const oldPath = joinPath((await params).path);
    const body = await request.json().catch(() => ({}));
    const parsed = notesRename.input.safeParse({ path: oldPath, newPath: body.newPath, dir: body.dir === true });
    if (!parsed.success) return Response.json({ error: "newPath is required" }, { status: 400 });
    const expected = z.string().nullable().optional().safeParse(body.expectedRevision);
    if (!expected.success) return Response.json({ error: "Invalid expectedRevision" }, { status: 400 });
    const storage = contentStorage();
    const { newPath, dir } = parsed.data;
    if (dir) {
      const current = await storage.readDirectory(oldPath);
      if (expected.data !== undefined && (current?.revision ?? null) !== expected.data) throw new ContentConflictError(oldPath);
      if (!current) return Response.json({ error: "Rename failed — source missing or target exists" }, { status: 409 });
      const result = await storage.moveDirectory(oldPath, newPath, current.revision);
      invalidateVault(vaultId);
      return Response.json(result);
    }
    const source = pathFor(oldPath);
    const destination = pathFor(newPath);
    const current = await storage.read(source);
    if (!matchesExpected(current, expected.data, undefined)) throw new ContentConflictError(oldPath);
    if (!current) return Response.json({ error: "Rename failed — source missing or target exists" }, { status: 409 });
    const result = source === destination ? current : await storage.move(source, destination, current.revision);
    invalidateVault(vaultId);
    return Response.json(responseFile(result, vaultId));
  }, `${vaultId}.patch`);

  return { GET, PUT, POST, DELETE, PATCH };
}

export async function getVaultTree(vaultId: VaultId) {
  const { applyVaultOrder } = await import("./vault-order");
  const vault = getVault(vaultId);
  const entries = getVaultStorage(vaultId).list();
  return applyVaultOrder(entries, vault.getRoot());
}
