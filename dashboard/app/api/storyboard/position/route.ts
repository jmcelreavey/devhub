import { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { setCardPosition } from "@/lib/storyboard/position";

export const dynamic = "force-dynamic";

const PositionSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  before: z.string().trim().min(1).max(128).optional(),
  after: z.string().trim().min(1).max(128).optional(),
  to: z.enum(["top", "bottom"]).optional(),
  rank: z.string().trim().min(1).max(64).optional(),
}).strict();

/** Move a card within its column (MCP storyboard_position). Writes the card's rank in its note's task-meta. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PositionSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return storyboardJson(setCardPosition(parsed.data));
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.position.post");
