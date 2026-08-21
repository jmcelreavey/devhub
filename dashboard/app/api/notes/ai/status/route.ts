import { NextResponse } from "next/server";
import { isAiConfigured, resolveAiProvider } from "@/lib/ai/preference";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = resolveAiProvider();
  const httpConfigured = isNotesAiConfigured();
  return NextResponse.json({
    /** Back-compat: notes editor / streaming tutors need the HTTP API. */
    configured: httpConfigured,
    /** Oneshot generation (learn-repo, briefings) via CLI or API. */
    generationConfigured: isAiConfigured(),
    httpConfigured,
    provider: resolved.provider,
    configuredProvider: resolved.configured,
    fallback: resolved.fallback,
    setupHint: resolved.setupHint,
  });
}
