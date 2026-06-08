import { NextRequest, NextResponse } from "next/server";
import { deleteLocalRepo } from "@/lib/repos";

type Params = { params: Promise<{ name: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const deleted = deleteLocalRepo(name);
    return NextResponse.json({ ok: true, repo: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Repo not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Invalid") || message.includes("Refusing")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api:repos:delete]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
