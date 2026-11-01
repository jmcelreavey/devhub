/** Shared plumbing for the plugin API routes. */
import { getResourceRoot } from "../desktop/runtime-paths";
import { PluginApiError, pluginContext, type PluginContext } from "./context";
import { PluginBusyError } from "./lock";
import { MANAGEMENT_BLOCKED, decideManagement } from "./management-auth";

const MAX_BODY_BYTES = 64 * 1024;

/** Every plugin response is private and fresh. */
export function pluginJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function envelope(code: string, message: string, retryable: boolean, operationId: string | null, status: number): Response {
  return pluginJson({ error: { code, message, retryable, operationId } }, status);
}

export function pluginError(err: unknown): Response {
  if (err instanceof PluginApiError) return envelope(err.code, err.message, err.retryable, err.operationId ?? null, err.status);
  if (err instanceof PluginBusyError) return envelope("BUSY", err.message, true, null, 409);
  // Anything else may carry paths or command output; none of it is passed on.
  return envelope("INTERNAL", "Couldn’t finish updating plugin settings. Check Plugins for the current state.", true, null, 500);
}

export function assertPluginManagement(req: Request): { ok: true } | { ok: false; response: Response } {
  const decision = decideManagement(req);
  if (decision.ok) return { ok: true };
  return { ok: false, response: envelope("FORBIDDEN", MANAGEMENT_BLOCKED, false, null, decision.status) };
}

export function serverPluginContext(): PluginContext {
  return pluginContext({ repoRoot: getResourceRoot() });
}

export async function readJson(req: Request, options: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new PluginApiError(413, "BODY_TOO_LARGE", "The request is too large.");
  let text: string;
  const reader = req.body?.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PluginApiError(413, "BODY_TOO_LARGE", "The request is too large.");
      }
      chunks.push(next.value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } catch (err) {
    if (err instanceof PluginApiError) throw err;
    throw new PluginApiError(400, "INVALID_JSON", "The request body must be JSON.");
  } finally {
    reader?.releaseLock();
  }
  if (options.allowEmpty && !text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new PluginApiError(400, "INVALID_JSON", "The request body must be JSON.");
  }
}
