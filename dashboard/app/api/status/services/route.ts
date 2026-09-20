import { aionCatalog } from "@/lib/aionui/catalog";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    await aionCatalog();
    return NextResponse.json({ agents: { active: true, uptime: null } });
  } catch {
    return NextResponse.json({ agents: { active: false, uptime: null } });
  }
}
