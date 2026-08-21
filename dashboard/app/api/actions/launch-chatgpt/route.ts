import { NextResponse } from "next/server";
import { launchDesktopApp } from "@/lib/launch/desktop";

const CONFIG = {
  appName: "ChatGPT",
  macAppName: "ChatGPT",
  linuxBinName: "codex",
  releasesUrl: "https://chatgpt.com/download",
  webFallbackUrl: "https://chatgpt.com",
};

export async function POST() {
  const result = await launchDesktopApp(CONFIG);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
