import { NextResponse } from "next/server";
import { launchDesktopApp } from "@/lib/launch-desktop";

const CONFIG = {
  appName: "OpenChamber",
  macAppName: "OpenChamber",
  linuxBinName: "openchamber",
  releasesUrl: "https://github.com/openchamber/openchamber/releases/latest",
  webFallbackUrl: "http://localhost:1336",
  envInject: { key: "OPENCHAMBER_SERVER_URL", valueFn: () => `http://localhost:${process.env.OPENCHAMBER_PORT ?? "1336"}` },
};

export async function POST() {
  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
