import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { BriefingShareSchema } from "@/lib/schemas";
import { mapGithubCliError } from "@/lib/gh-exec";
import { publishShare, unpublishShare, readShare } from "@/lib/briefing-share";
import { normalizeTheme } from "@/lib/briefing-theme";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ ok: true, share: readShare() }, { headers: NO_STORE });
}, "briefing.share.get");

// Publish (or refresh) a shareable snapshot of the current canvas as a secret gist.
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, BriefingShareSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const share = await publishShare(normalizeTheme(parsed.data.theme));
    return NextResponse.json({ ok: true, share }, { headers: NO_STORE });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to publish briefing");
    return NextResponse.json({ ok: false, error }, { status });
  }
}, "briefing.share.post");

export const DELETE = withErrorHandler(async () => {
  try {
    const removed = await unpublishShare();
    return NextResponse.json({ ok: true, removed }, { headers: NO_STORE });
  } catch (err) {
    const { status, error } = mapGithubCliError(err, "Failed to remove share");
    return NextResponse.json({ ok: false, error }, { status });
  }
}, "briefing.share.delete");
