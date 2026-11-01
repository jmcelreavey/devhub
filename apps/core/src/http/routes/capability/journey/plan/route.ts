import { capabilityLabPlan } from "../../../../../../../../packages/shared/actions/capability";
import { planLab } from "../../../../../lib/capability/journey";
import { readLatestSnapshot } from "../../../../../lib/capability/snapshots";


/**
 * Everything the capability-lab OpenCode skill needs to build a lab for a
 * signal (target repo, evidence, workspace dir, services, language, notes
 * path). The client turns this into an `opencode run` command for the
 * terminal dock.
 */
export async function GET(req: Request) {
  const signalId = new URL(req.url).searchParams.get("signalId")?.trim();
  if (!signalId) return Response.json({ error: "signalId required" }, { status: 400 });
  const repoName = new URL(req.url).searchParams.get("repoName")?.trim() || undefined;


  return await capabilityLabPlan.handler({ signalId, repoName }, { execute: async () => {
    const snapshot = readLatestSnapshot();
    if (!snapshot) return Response.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

    try {
      const plan = await planLab(snapshot, { signalId, repoName });
      return Response.json(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /unknown signal|no local repo/i.test(message) ? 404 : 500;
      if (status === 500) console.error("[api:capability:journey:plan]", err);
      return Response.json({ error: message.slice(0, 200) }, { status });
    }
  } }) as Response;
}
