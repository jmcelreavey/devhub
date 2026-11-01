import { recoveryCreate, recoveryRead } from "../../../../../../packages/shared/actions/recovery";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { createBundle, inventory } from "../../../lib/recovery/bundle";
import { recoveryStores } from "../../../lib/recovery/stores";
import { getReposDir } from "../../../lib/desktop/runtime-paths";


const downloads = new Map<string, { file: string; expires: number }>();
export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const token = new URL(request.url).searchParams.get("download");
  return await recoveryRead.handler({ download: token }, { execute: ({ download }) => readRecovery(download) }) as Response;
}, "recovery.inventory");

async function readRecovery(token: string | null) {
  if (token) {
    const download = downloads.get(token);
    if (!download || download.expires < Date.now()) return Response.json({ error: "Backup download expired. Create a new backup." }, { status: 410 });
    return new Response(Readable.toWeb(fs.createReadStream(download.file)) as ReadableStream, { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="devhub-${new Date().toISOString().slice(0, 10)}.devhub"`,
      "Content-Length": String((await fsp.stat(download.file)).size),
    } });
  }
  const stores = recoveryStores();
  const files = await inventory(stores);
  return Response.json({
    files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0),
    stores: stores.map(store => ({ id: store.id, files: files.filter(file => file.name.startsWith(store.id + "/")).length })),
  }, { headers: { "Cache-Control": "no-store" } });
}
export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const input = await parseBody(request, recoveryCreate.input);
  if (!input.ok) return input.response;
  return await recoveryCreate.handler(input.data, { execute: ({ passphrase }) => createRecovery(passphrase) }) as Response;
}, "recovery.create");

async function createRecovery(passphrase: string) {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "devhub-download-"));
  const file = path.join(temporary, "backup.devhub");
  try {
    const result = await createBundle(recoveryStores(), passphrase, file, getReposDir());
    const token = randomUUID();
    downloads.set(token, { file, expires: Date.now() + 15 * 60_000 });
    setTimeout(() => {
      downloads.delete(token);
      void fsp.rm(temporary, { recursive: true, force: true }).catch(error => console.error("Could not remove expired encrypted backup", error));
    }, 15 * 60_000).unref();
    return Response.json({ ...result, downloadUrl: "/api/recovery?download=" + token });
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true });
    return Response.json({ error: error instanceof Error ? error.message : "Couldn’t create the backup." }, { status: 400 });
  }
}
