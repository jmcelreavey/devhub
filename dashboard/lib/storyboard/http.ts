import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PluginBusyError } from "@/lib/plugins/lock";
import { StoryboardError } from "./errors";

const NO_STORE = { "Cache-Control": "no-store" };

/** Private board data must never be cached by the browser or a proxy. */
export function storyboardJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Consistent JSON errors: validation 400, missing 404, stale revision 409 with
 * the current revision, busy lock 429. A corrupt board file is a 500 that says
 * so — never an empty board.
 */
export function storyboardError(error: unknown): NextResponse {
  if (error instanceof StoryboardError) {
    return storyboardJson({ error: error.message, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) }, error.status);
  }
  if (error instanceof PluginBusyError) return storyboardJson({ error: "The board is busy with another change. Try again." }, 429);
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return storyboardJson({ error: "A stored board file is corrupt or unreadable. It has not been changed; fix or restore it from git." }, 500);
  }
  throw error;
}
