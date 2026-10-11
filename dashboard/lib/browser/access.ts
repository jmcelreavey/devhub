import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, isSameOriginStrict } from "@/lib/api-utils";

export function browserHumanRequest(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if ((req.method !== "GET" && !isSameOriginStrict(req)) || req.headers.get("x-devhub-client") === "mcp")
    return NextResponse.json({ error: "Use the browser controls in DevHub." }, { status: 403 });
}
export function browserError(error: unknown) {
  const message = error instanceof Error && !error.message.includes("\n") && error.message.length < 220
    ? error.message : "Browser operation failed. Check Chrome, then retry from DevHub.";
  return NextResponse.json({ error: message }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
