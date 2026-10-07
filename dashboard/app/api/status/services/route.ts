import { NextResponse } from "next/server";
import { listPaseoProviders } from "@/lib/paseo/providers";

export async function GET() {
  try {
    await listPaseoProviders();
    return NextResponse.json({ agents: { active: true, uptime: null } });
  } catch {
    return NextResponse.json({ agents: { active: false, uptime: null } });
  }
}
