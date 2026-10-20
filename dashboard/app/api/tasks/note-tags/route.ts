import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { taskNoteTags } from "@/lib/tasks/note-tags";

export const dynamic = "force-dynamic";

/** taskId → tags carried by its task note, for the Work tag filter. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ tags: taskNoteTags() });
}, "tasks.noteTags.get");
