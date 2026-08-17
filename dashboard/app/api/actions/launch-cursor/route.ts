import { NextResponse } from "next/server";
import { launchDesktopApp } from "@/lib/launch/desktop";

const CONFIG = {
  appName: "Cursor",
  macAppName: "Cursor",
  linuxBinName: "cursor",
  releasesUrl: "https://cursor.com/download",
  webFallbackUrl: "https://cursor.com/download",
};

export async function POST() {
  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
