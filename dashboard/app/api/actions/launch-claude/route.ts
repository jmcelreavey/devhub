import { NextResponse } from "next/server";
import { launchDesktopApp } from "@/lib/launch-desktop";

const CONFIG = {
  appName: "Claude",
  macAppName: "Claude",
  linuxBinName: "claude",
  releasesUrl: "https://claude.ai/download",
  webFallbackUrl: "https://claude.ai/new",
};

export async function POST() {
  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
