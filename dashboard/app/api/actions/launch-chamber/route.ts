import { NextResponse } from "next/server";
import { ensureChamberListening } from "@/lib/dev-peer-services";
import { launchDesktopApp } from "@/lib/launch/desktop";

const CONFIG = {
  appName: "OpenChamber",
  macAppName: "OpenChamber",
  linuxBinName: "openchamber",
  releasesUrl: "https://github.com/openchamber/openchamber/releases/latest",
  webFallbackUrl: "http://localhost:1336",
  relaunchExisting: true,
  envInject: { key: "OPENCHAMBER_SERVER_URL", valueFn: () => `http://localhost:${process.env.OPENCHAMBER_PORT ?? "1336"}` },
};

export async function POST() {
  // The app is pointed at DevHub's server via OPENCHAMBER_SERVER_URL, so it
  // needs one listening. Best-effort: the app starts its own if 1336 is down.
  await ensureChamberListening().catch(() => undefined);

  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
