import { NextResponse } from "next/server";
import { IntegrationError } from "./types";
import type { DirectWrite } from "./write-store";

export function integrationFailure(error: unknown) {
  const status = error instanceof IntegrationError ? ({ auth: 401, "rate-limit": 429, "not-found": 404, unsupported: 422, conflict: 409, unavailable: 503, invalid: 400 })[error.kind] : 503;
  return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "The integration could not complete this request. Refresh its status before trying again." }, { status });
}
export function writeSource(req: Request) { return req.headers.get("x-devhub-client") === "mcp" ? "MCP" : "DevHub"; }
export function serverTiming(timings: Record<string, number>) {
  return { "Server-Timing": Object.entries(timings).map(([name, dur]) => name + ";dur=" + dur).join(", ") };
}
/** Legacy routes answer a direct write in their old shape, plus the receipt, so callers need no new handling. */
export function directOutcome({ result, timings }: DirectWrite, legacy: Record<string, unknown>, successStatus = 200) {
  const headers = serverTiming(timings);
  if (result.state === "succeeded") return NextResponse.json({ ...legacy, ok: true, result }, { status: successStatus, headers });
  const outcome = result.state === "unknown" ? "unknown" : "failed";
  return NextResponse.json({ error: result.detail ?? "The action was not completed.", outcome, result }, { status: 409, headers });
}
