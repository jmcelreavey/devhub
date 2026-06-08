import { NextResponse } from "next/server";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: isNotesAiConfigured() });
}
