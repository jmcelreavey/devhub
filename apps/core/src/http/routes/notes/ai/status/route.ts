import { notesAiStatus } from "../../../../../../../../packages/shared/actions/notes";
import { resolveAiProvider } from "../../../../../lib/ai/preference";
import { isNotesAiConfigured } from "../../../../../lib/notes-ai/config";


export async function GET() {
  return await notesAiStatus.handler(notesAiStatus.input.parse({}), { execute: async () => {
    const resolved = await resolveAiProvider();
    const httpConfigured = isNotesAiConfigured();
    return Response.json({
      /** Back-compat: notes editor / streaming tutors need the HTTP API. */
      configured: httpConfigured,
      /** Oneshot generation (learn-repo, briefings) via CLI or API. */
      generationConfigured: resolved.provider !== null,
      httpConfigured,
      provider: resolved.provider,
      configuredProvider: resolved.configured,
      fallback: resolved.fallback,
      setupHint: resolved.setupHint,
    });
  } }) as Response;
}
