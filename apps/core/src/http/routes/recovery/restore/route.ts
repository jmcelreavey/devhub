import fs from "node:fs";
import { recoveryRestore } from "../../../../../../../packages/shared/actions/recovery";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { restoreBundle } from "../../../../lib/recovery/bundle";


const optionsSchema = z.object({
  passphrase: z.string().min(12).max(1024),
  parent: z.string().max(4096).optional(),
  repositoriesRoot: z.string().max(4096).optional(),
}).strict();
export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;
  const rawOptions = request.headers.get("X-DevHub-Recovery");
  if (!request.body || !rawOptions || rawOptions.length > 20_000) return Response.json({ error: "Choose a backup and enter its passphrase." }, { status: 400 });
  return await recoveryRestore.handler({ options: rawOptions, bundle: request.body }, {
    execute: ({ options, bundle }) => restore(options as string, bundle as ReadableStream),
  }) as Response;
}, "recovery.restore");

async function restore(rawOptions: string, bundle: ReadableStream) {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "devhub-upload-"));
  const file = path.join(temporary, "backup.devhub");
  try {
    const options = optionsSchema.parse(JSON.parse(decodeURIComponent(rawOptions)));
    if (options.parent && !path.isAbsolute(options.parent)) throw new Error("Recovery folder must be absolute.");
    let bytes = 0;
    await pipeline(Readable.fromWeb(bundle as import("node:stream/web").ReadableStream), async function* (source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > 128 * 1024 * 1024) throw new Error("Browser restore supports backups up to 128 MiB.");
        yield chunk;
      }
    }, fs.createWriteStream(file, { flags: "wx", mode: 0o600 }));
    const result = await restoreBundle(file, options.passphrase, options.parent || os.homedir(), { repositoriesRoot: options.repositoriesRoot || undefined });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Couldn’t restore the backup." }, { status: 400 });
  } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
}
