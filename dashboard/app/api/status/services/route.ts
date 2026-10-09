import { NextResponse } from "next/server";
import { readPaseoManaged } from "@/lib/paseo/managed";
import { listPaseoProviders } from "@/lib/paseo/providers";

export async function GET() {
  try {
    await listPaseoProviders();
    return NextResponse.json({ agents: { active: true, uptime: null } });
  } catch {
    let optional = false;
    try {
      optional = readPaseoManaged() == null;
    } catch {
      optional = false;
    }
    return NextResponse.json({ agents: { active: false, uptime: null, optional } });
  }
}
