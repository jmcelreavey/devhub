import { NextRequest, NextResponse } from "next/server";
import { readLabRecord } from "@/lib/capability/journey";
import { openPathInCursor } from "@/lib/cursor-open";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * Open a lab's hands-on workspace directory in Cursor. The path comes from the
 * lab record (server-side), never from the client, so this can't be used to
 * open arbitrary paths.
 */
const OpenWorkspaceSchema = z.object({
  category: z.string().trim().min(1, "category required"),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, OpenWorkspaceSchema);
  if (!parsed.ok) return parsed.response;
  const category = parsed.data.category;

  const record = readLabRecord(category);
  if (!record?.workspacePath) {
    return NextResponse.json({ error: "Lab has no workspace" }, { status: 404 });
  }

  const error = openPathInCursor(record.workspacePath);
  if (error) return NextResponse.json({ error }, { status: 503 });

  return NextResponse.json({ ok: true, path: record.workspacePath });
}
