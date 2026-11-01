import { capabilityLabAdopt } from "../../../../../../../../packages/shared/actions/capability";
import { adoptLab } from "../../../../../lib/capability/journey";
import { readLatestSnapshot } from "../../../../../lib/capability/snapshots";


/**
 * Called by the capability-lab OpenCode skill after it has written the lab
 * note (notes MCP) and the workspace starter files: verifies citations,
 * scaffolds the deterministic workspace baseline, creates the follow-up task,
 * and persists the lab record the UI reads.
 */
export async function POST(req: Request) {
  let body: { signalId?: string; repoName?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const signalId = body.signalId?.trim();
  if (!signalId) return Response.json({ error: "signalId required" }, { status: 400 });


  return await capabilityLabAdopt.handler({ signalId, repoName: body.repoName?.trim() || undefined }, { execute: async () => {
    const snapshot = readLatestSnapshot();
    if (!snapshot) return Response.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

    try {
      const lab = await adoptLab(snapshot, { signalId, repoName: body.repoName?.trim() || undefined });
      return Response.json({
        ok: true,
        category: lab.category,
        repoName: lab.repoName,
        workspacePath: lab.workspacePath ?? null,
        starterFiles: lab.starterFiles ?? [],
        unverifiedPaths: lab.unverifiedPaths,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /unknown signal|no local repo|no lab note/i.test(message) ? 404 : 500;
      if (status === 500) console.error("[api:capability:journey:adopt]", err);
      return Response.json({ error: message.slice(0, 200) }, { status });
    }
  } }) as Response;
}
