import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { buildGraph, neighbours } from "@/lib/recall/graph";
import { loadIndex } from "@/lib/recall/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/recall/graph?entity=jira:PTF-3774&minWeight=2
 *
 * Without `entity`, returns the whole derived graph (capped). With it, returns
 * that entity's neighbourhood — the "what else was going on around this"
 * lookup that `entity-links` can only answer for hand-linked notes.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const index = loadIndex();
  if (!index) {
    return NextResponse.json({ nodes: [], edges: [], indexBuiltAt: null, note: "Index not built." });
  }

  const minWeightRaw = Number(req.nextUrl.searchParams.get("minWeight") ?? 1);
  const minWeight = Number.isFinite(minWeightRaw) ? Math.max(1, minWeightRaw) : 1;
  const graph = buildGraph(index.chunks, { minWeight });

  const entity = req.nextUrl.searchParams.get("entity");
  if (entity) {
    const node = graph.nodes.find((n) => n.key === entity) ?? null;
    return NextResponse.json({
      entity: node,
      neighbours: neighbours(graph, entity),
      indexBuiltAt: index.manifest.builtAt,
    });
  }

  return NextResponse.json({
    nodes: graph.nodes.slice(0, 300),
    edges: graph.edges,
    totalNodes: graph.nodes.length,
    indexBuiltAt: index.manifest.builtAt,
  });
}, "recall.graph");
