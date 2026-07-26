import { NextResponse } from "next/server";
import { checkDependencies } from "@/lib/setup/dependencies";

/**
 * Which external tools are actually installed. Read-only.
 *
 * Each probe spawns the binary with a short timeout, so this is deliberately
 * not called on every page - only the setup screen asks for it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(checkDependencies());
}
