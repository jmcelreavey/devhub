import { NextRequest } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { readNotesBoard } from "@/lib/storyboard/notes-board";

export const dynamic = "force-dynamic";

/** Stuck cards (waiting on John, failing, idle agent) with the one action that unblocks each. Used by the MCP server. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const cards = readNotesBoard().cards.flatMap((card) => card.attention
      ? [{ taskId: card.taskId, title: card.title, status: card.status, noteHref: card.noteHref, runId: card.run?.runId, ...card.attention }]
      : []);
    return storyboardJson({ cards });
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.attention.get");
