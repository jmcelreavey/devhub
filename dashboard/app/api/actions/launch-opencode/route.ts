import { NextResponse } from "next/server";
import { launchDesktopApp } from "@/lib/launch-desktop";

const CONFIG = {
  appName: "OpenCode",
  macAppName: "OpenCode",
  linuxBinName: "opencode",
  releasesUrl: "https://github.com/anomalyco/opencode/releases/latest",
  releasesApiUrl: "https://api.github.com/repos/anomalyco/opencode/releases/latest",
};

export async function POST() {
  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
