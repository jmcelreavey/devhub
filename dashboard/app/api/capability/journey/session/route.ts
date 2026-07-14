import { NextRequest, NextResponse } from "next/server";
import { clearLabSession, readLabSession, writeLabSession } from "@/lib/capability/journey";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category")?.trim();
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });
  const session = readLabSession(category);
  return NextResponse.json({ messages: session?.messages ?? [], updatedAt: session?.updatedAt ?? null });
}

export async function POST(req: NextRequest) {
  let body: { category?: string; messages?: unknown[]; clear?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const category = body.category?.trim();
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });

  try {
    if (body.clear) {
      clearLabSession(category);
      return NextResponse.json({ ok: true, cleared: true });
    }
    await writeLabSession(category, Array.isArray(body.messages) ? body.messages : []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api:capability:journey:session]", err);
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
