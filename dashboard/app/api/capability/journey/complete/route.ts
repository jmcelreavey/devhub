import { NextRequest, NextResponse } from "next/server";
import { markLabComplete } from "@/lib/capability/journey";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { category?: string; done?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const category = body.category?.trim();
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });

  try {
    const record = await markLabComplete(category, body.done !== false);
    if (!record) return NextResponse.json({ error: "Lab not found" }, { status: 404 });
    return NextResponse.json({ category: record.category, done: record.done, completedAt: record.completedAt });
  } catch (err) {
    console.error("[api:capability:journey:complete]", err);
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
