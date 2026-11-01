import { capabilityExplain, capabilityExplainInput } from "../../../../../../../packages/shared/actions/capability";
import { parseBody } from "../../../../lib/api-utils";
import { diffSnapshots } from "../../../../lib/capability/diff";
import { explainDelta } from "../../../../lib/capability/explain";
import { readLatestSnapshot, readPreviousSnapshot } from "../../../../lib/capability/snapshots";
import type { DiffEntry } from "../../../../../../../packages/shared/ui-lib/capability/types";


const ExplainSchema = capabilityExplainInput;

export async function POST(req: Request) {
  const parsed = await parseBody(req, ExplainSchema);
  if (!parsed.ok) return parsed.response;
  const { deltaId } = parsed.data;
  const body = parsed.data;


  return await capabilityExplain.handler(parsed.data, { execute: async () => {
    const snapshot = readLatestSnapshot();
    if (!snapshot) return Response.json({ error: "No snapshot yet — run a scan first." }, { status: 404 });

    const diff = diffSnapshots(snapshot, readPreviousSnapshot(snapshot.id));

    // Prefer the actual diff entry (has from/to counts); fall back to a synthetic
    // entry built from the current rollup so any signal can be explained.
    let entry: DiffEntry | undefined = [...diff.added, ...diff.spread, ...diff.removed].find((e) => e.id === deltaId);
    if (!entry) {
      const roll = snapshot.signals[deltaId];
      if (!roll) return Response.json({ error: `Unknown signal: ${deltaId}` }, { status: 404 });
      entry = {
        id: roll.id,
        label: roll.label,
        kind: roll.kind,
        area: roll.area,
        repos: roll.repos,
        evidence: [],
      };
    }

    try {
      const explanation = await explainDelta(snapshot, entry, body.refresh === true);
      return Response.json(explanation);
    } catch (err) {
      console.error("[api:capability:explain]", err);
      return Response.json({ error: "Explain failed", detail: String(err).slice(0, 200) }, { status: 500 });
    }
  } }) as Response;
}
