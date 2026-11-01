import { desktopUpstartAction, desktopUpstartRead } from "../../../../../../../packages/shared/actions/desktop";
import { parseBody } from "../../../../lib/api-utils";
import {
  approveUpstart,
  revokeApproval,
  upstartRunCommand,
  upstartState,
} from "../../../../lib/desktop/upstart-approval";

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


export async function GET(req: Request) {
  const repo = new URL(req.url).searchParams.get("repo");
  return await desktopUpstartRead.handler({ repo }, { execute: ({ repo: selectedRepo }) => readUpstart(selectedRepo) }) as Response;
}

function readUpstart(repo: string | null) {
  if (!repo) return Response.json({ error: "repo is required" }, { status: 400 });

  try {
    return Response.json(upstartState(repo));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, desktopUpstartAction.input);
  if (!parsed.ok) return parsed.response;
  return await desktopUpstartAction.handler(parsed.data, { execute: changeUpstart }) as Response;
}

function changeUpstart({ repo, action, sha256 }: ReturnType<typeof desktopUpstartAction.input.parse>) {
  try {
    if (action === "approve") {
      if (!sha256) {
        return Response.json(
          { error: "sha256 of the reviewed script is required" },
          { status: 400 },
        );
      }
      return Response.json({ ok: true, state: approveUpstart(repo, sha256) });
    }

    if (action === "revoke") {
      revokeApproval(repo);
      return Response.json({ ok: true, state: upstartState(repo) });
    }

    // "run" returns a command for the terminal dock to execute. It throws
    // unless the current bytes are approved, so this is the single enforcement
    // point rather than one of several.
    return Response.json({ ok: true, ...upstartRunCommand(repo) });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
