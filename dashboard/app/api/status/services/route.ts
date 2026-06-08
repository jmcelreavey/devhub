import { NextResponse } from "next/server";
import { isPeerServiceActive } from "@/lib/peer-service-availability";
import { DEV_SERVICES } from "@/lib/dev-services";

interface ServiceState {
  active: boolean;
  uptime: string | null;
}

export async function GET() {
  const results: Record<string, ServiceState> = {};

  await Promise.all(
    DEV_SERVICES.map(async (svc) => {
      const active = await isPeerServiceActive(svc.id as "openchamber" | "opencode");
      results[svc.id] = { active, uptime: null };
    }),
  );

  return NextResponse.json(results);
}
