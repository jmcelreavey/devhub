import { recallGraph } from "../../../../../../../packages/shared/actions/recall";
import { withErrorHandler } from "../../../../lib/api-utils";
import { cachedGraph, capGraph, neighbours } from "../../../../lib/recall/graph";
import { loadIndex } from "../../../../lib/recall/store";


/**
 * GET /api/recall/graph?entity=jira:ABC-3774&minWeight=2
 *
 * Without `entity`, returns the whole derived graph (capped). With it, returns
 * that entity's neighbourhood — the "what else was going on around this"
 * lookup that `entity-links` can only answer for hand-linked notes.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const rawWeight = Number(new URL(req.url).searchParams.get("minWeight") ?? 1);
  return await recallGraph.handler({ entity: new URL(req.url).searchParams.get("entity") ?? undefined, minWeight: Number.isFinite(rawWeight) ? Math.max(1, rawWeight) : 1 }, { execute: async () => {
    const index = loadIndex();
    if (!index) {
      return Response.json({ nodes: [], edges: [], indexBuiltAt: null, note: "Index not built." });
    }

    const minWeightRaw = Number(new URL(req.url).searchParams.get("minWeight") ?? 1);
    const minWeight = Number.isFinite(minWeightRaw) ? Math.max(1, minWeightRaw) : 1;
    const graph = cachedGraph(index, { minWeight });

    const entity = new URL(req.url).searchParams.get("entity");
    if (entity) {
      const node = graph.nodes.find((n) => n.key === entity) ?? null;
      return Response.json({
        entity: node,
        neighbours: neighbours(graph, entity),
        indexBuiltAt: index.manifest.builtAt,
      });
    }

    const capped = capGraph(graph);
    return Response.json({
      nodes: capped.nodes,
      edges: capped.edges,
      totalNodes: capped.totalNodes,
      indexBuiltAt: index.manifest.builtAt,
    });
  } }) as Response;
}, "recall.graph");
