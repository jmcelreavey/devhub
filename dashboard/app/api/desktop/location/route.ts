import { NextResponse } from "next/server";
import { isTranslocatedAppPath } from "@/lib/desktop/translocation";

export const dynamic = "force-dynamic";

/** Whether this process is still inside a DMG or App Translocation. No paths are returned. */
export function GET() {
  const flagged = process.env["DEVHUB_APP_TRANSLOCATED"] === "1";
  return NextResponse.json({
    translocated: flagged || isTranslocatedAppPath(process.execPath),
  });
}
