import { NextRequest, NextResponse } from "next/server";
import { readLabRecord } from "@/lib/capability/journey";
import { openPathInCursor } from "@/lib/cursor-open";

export const dynamic = "force-dynamic";

/**
 * Open a lab's hands-on workspace directory in Cursor. The path comes from the
 * lab record (server-side), never from the client, so this can't be used to
 * open arbitrary paths.
 */
export async function POST(req: NextRequest) {
  let body: { category?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const category = body.category?.trim();
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });

  const record = readLabRecord(category);
  if (!record?.workspacePath) {
    return NextResponse.json({ error: "Lab has no workspace" }, { status: 404 });
  }

  const error = openPathInCursor(record.workspacePath);
  if (error) return NextResponse.json({ error }, { status: 503 });

  return NextResponse.json({ ok: true, path: record.workspacePath });
}
