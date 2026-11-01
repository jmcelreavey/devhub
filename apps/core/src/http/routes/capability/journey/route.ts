import { capabilityJourneyList } from "../../../../../../../packages/shared/actions/capability";
import { capabilityGetLab } from "../../../../../../../packages/shared/actions/capability";
import { getLab, listLabRecords } from "../../../../lib/capability/journey";
import { readLatestSnapshot } from "../../../../lib/capability/snapshots";


/**
 * List generated labs (optionally for one repo) so the UI can show which
 * signals already have a lab — and its done state — before anyone clicks.
 */
export async function GET(req: Request) {
  const repoName = new URL(req.url).searchParams.get("repoName")?.trim() || undefined;

  return await capabilityJourneyList.handler({ repoName }, { execute: async () => {
    const labs = listLabRecords()
      .filter((r) => !repoName || r.repoName === repoName)
      .map(({ category, signalId, label, repoName: repo, generatedAt, source, done, completedAt, workspacePath }) => ({
        category,
        signalId,
        label,
        repoName: repo,
        generatedAt,
        source,
        done,
        completedAt,
        hasWorkspace: !!workspacePath,
      }))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return Response.json({ labs });
  } }) as Response;
}

/**
 * Fetch an existing lab. Read-only: generation happens in OpenCode (the
 * capability-lab skill), which registers the result via /journey/adopt.
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


  return await capabilityGetLab.handler({ signalId, repoName: body.repoName?.trim() || undefined }, { execute: async () => {
    const snapshot = readLatestSnapshot();
    if (!snapshot) return Response.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

    try {
      const lab = getLab(snapshot, { signalId, repoName: body.repoName?.trim() || undefined });
      if (!lab) {
        return Response.json(
          { error: "No lab yet — build it with OpenCode from the UI.", notBuilt: true },
          { status: 404 },
        );
      }
      return Response.json(lab);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "Unknown signal" / "No local repo" are client-fixable → 404; else 500.
      const status = /unknown signal|no local repo/i.test(message) ? 404 : 500;
      if (status === 500) console.error("[api:capability:journey]", err);
      return Response.json({ error: message.slice(0, 200) }, { status });
    }
  } }) as Response;
}
