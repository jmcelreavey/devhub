import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  approveUpstart,
  revokeApproval,
  upstartRunCommand,
  upstartState,
} from "@/lib/desktop/upstart-approval";

/**
 * Upstart review and approval.
 *
 * `GET ?repo=` returns the script and its state. `POST` approves a specific
 * hash, revokes, or asks for the run command — and the run command is only
 * ever produced for a script whose exact current bytes are approved.
 *
 * Not gated on desktop mode: reviewing before running is the right behaviour
 * in a checkout too. The old `agent … && bash script` chain meant nobody ever
 * saw the script, and that was as true in the browser as in the app.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "repo is required" }, { status: 400 });

  try {
    return NextResponse.json(upstartState(repo));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

const ActionSchema = z.object({
  repo: z.string().max(200),
  action: z.enum(["approve", "revoke", "run"]),
  /**
   * Required for approval: the hash of the bytes the user actually read.
   * Without it, "approve" would mean "approve whatever is on disk now", which
   * is exactly the race an agent still writing the file would win.
   */
  sha256: z.string().length(64).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, ActionSchema);
  if (!parsed.ok) return parsed.response;
  const { repo, action, sha256 } = parsed.data;

  try {
    if (action === "approve") {
      if (!sha256) {
        return NextResponse.json(
          { error: "sha256 of the reviewed script is required" },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true, state: approveUpstart(repo, sha256) });
    }

    if (action === "revoke") {
      revokeApproval(repo);
      return NextResponse.json({ ok: true, state: upstartState(repo) });
    }

    // "run" returns a command for the terminal dock to execute. It throws
    // unless the current bytes are approved, so this is the single enforcement
    // point rather than one of several.
    return NextResponse.json({ ok: true, ...upstartRunCommand(repo) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
