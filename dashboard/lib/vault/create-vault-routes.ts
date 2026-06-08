import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { blocksToText } from "@/lib/markdown-convert";
import { formatZodError, NotePutSchema } from "@/lib/schemas";
import { withErrorHandler } from "@/lib/api-utils";
import { getVault, getVaultStorage, type VaultId } from "@/lib/vault/vault-registry";
import { z } from "zod";

type Params = { params: Promise<{ path: string[] }> };

const DocPutSchema = z.object({
  content: z.union([z.string(), z.array(z.unknown())]),
});

function joinPath(segments: string[]): string {
  return segments.join("/");
}

function normalizeWriteContent(vaultId: VaultId, content: unknown): unknown {
  if (vaultId === "docs") {
    if (Array.isArray(content)) {
      return blocksToText(content);
    }
    if (typeof content === "string") {
      return content;
    }
    throw new Error("Docs content must be markdown string or blocks array");
  }
  return content;
}

export function createVaultRoutes(vaultId: VaultId) {
  const vault = getVault(vaultId);
  const putSchema = vaultId === "docs" ? DocPutSchema : NotePutSchema;

  const GET = withErrorHandler(async (_req: NextRequest, { params }: Params) => {
    const { path: segments } = await params;
    const filePath = joinPath(segments);
    const file = getVaultStorage(vaultId).read(filePath);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(file);
  }, `${vaultId}.get`);

  const PUT = withErrorHandler(async (req: NextRequest, { params }: Params) => {
    const { path: segments } = await params;
    const filePath = joinPath(segments);
    const body = await req.json().catch(() => ({}));
    const parsed = putSchema.safeParse(body);
    if (!parsed.success || parsed.data.content === undefined) {
      return NextResponse.json(
        { error: parsed.success ? "Content is required" : formatZodError(parsed.error) },
        { status: 400 },
      );
    }
    const content = normalizeWriteContent(vaultId, parsed.data.content);
    const result = getVaultStorage(vaultId).write(filePath, content);
    for (const p of vault.revalidatePaths) {
      revalidatePath(p);
    }
    return NextResponse.json(result);
  }, `${vaultId}.put`);

  const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
    const { path: segments } = await params;
    const filePath = joinPath(segments);
    const body = await req.json().catch(() => ({}));
    const parsed = putSchema.safeParse(body);
    if (!parsed.success || parsed.data.content === undefined) {
      return NextResponse.json(
        { error: parsed.success ? "Content is required" : formatZodError(parsed.error) },
        { status: 400 },
      );
    }
    if (getVaultStorage(vaultId).read(filePath)) {
      return NextResponse.json(
        { error: "Already exists — use PUT to update" },
        { status: 409 },
      );
    }
    const content = normalizeWriteContent(vaultId, parsed.data.content);
    const result = getVaultStorage(vaultId).write(filePath, content);
    for (const p of vault.revalidatePaths) {
      revalidatePath(p);
    }
    return NextResponse.json(result, { status: 201 });
  }, `${vaultId}.post`);

  const DELETE = withErrorHandler(async (req: NextRequest, { params }: Params) => {
    const { path: segments } = await params;
    const filePath = joinPath(segments);
    const isDir = new URL(req.url).searchParams.get("dir") === "1";
    const storage = getVaultStorage(vaultId);
    if (isDir) {
      if (!filePath) {
        return NextResponse.json({ error: "Folder path required" }, { status: 400 });
      }
      const deleted = storage.deleteDir(filePath);
      if (!deleted) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      for (const p of vault.revalidatePaths) {
        revalidatePath(p);
      }
      return NextResponse.json({ ok: true, path: filePath });
    }
    const deleted = storage.delete(filePath);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    for (const p of vault.revalidatePaths) {
      revalidatePath(p);
    }
    return NextResponse.json({ ok: true, path: filePath });
  }, `${vaultId}.delete`);

  const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
    const { path: segments } = await params;
    const oldPath = joinPath(segments);
    const body = await req.json().catch(() => ({}));
    const newPath = body.newPath;
    if (typeof newPath !== "string" || !newPath.trim()) {
      return NextResponse.json({ error: "newPath is required" }, { status: 400 });
    }
    const storage = getVaultStorage(vaultId);
    const result = body.dir === true
      ? storage.renameDir(oldPath, newPath.trim())
      : storage.rename(oldPath, newPath.trim());
    if (!result) {
      return NextResponse.json(
        { error: "Rename failed — source missing or target exists" },
        { status: 409 },
      );
    }
    for (const p of vault.revalidatePaths) {
      revalidatePath(p);
    }
    return NextResponse.json(result);
  }, `${vaultId}.patch`);

  return { GET, PUT, POST, DELETE, PATCH };
}

export async function getVaultTree(vaultId: VaultId) {
  const { applyVaultOrder } = await import("@/lib/vault/vault-order");
  const vault = getVault(vaultId);
  const entries = getVaultStorage(vaultId).list();
  return applyVaultOrder(entries, vault.getRoot());
}
