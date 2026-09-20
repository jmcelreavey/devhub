import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth } from "@/lib/api-utils";
import { execExternal } from "@/lib/exec-external";
import { getRepoRoot } from "@/lib/content/dirs";
import { withMutex } from "@/lib/atomic-write";
import { aionBrowserCookies, connectAion, currentAionSession, publicAionConnection, setDefaultAionAssistant } from "@/lib/aionui/session";
import { applyGraphiteNeonTheme } from "@/lib/aionui/theme";
import { ensureAionOpenAiBootstrap, DEVHUB_AION_CLI_ASSISTANT_NAME } from "@/lib/aionui/openai-bootstrap";
import { ensureAionMcpBootstrap } from "@/lib/aionui/mcp-bootstrap";
import { aionUpdateStatus } from "@/lib/aionui/update";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const status = await aionUpdateStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch {
    return NextResponse.json({ installed: true, available: false, checkFailed: true });
  }
}
export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(req.nextUrl.hostname)) return NextResponse.json({ error: "Set up Agents from the local DevHub dashboard." }, { status: 403 });
  const input = z.object({ action: z.enum(["setup", "update", "theme"]).default("setup") }).parse(await req.json().catch(() => ({})));
  return withMutex("aionui:install", async () => {
    try {
      if (input.action !== "theme") await execExternal(process.execPath, [path.join(getRepoRoot(), "scripts", "install-aionui.mjs"), ...(input.action === "update" ? ["--update"] : [])], { timeoutMs: 600_000, maxBuffer: 2_000_000, label: `agents:${input.action}` });
      const bootstrap = path.join(os.homedir(), ".config", "devhub", "aionui-bootstrap.json");
      let session;
      if (fs.existsSync(bootstrap)) {
        const input = z.object({ origin: z.string(), username: z.string(), password: z.string() }).parse(JSON.parse(fs.readFileSync(bootstrap, "utf8")));
        session = await connectAion(input);
        fs.rmSync(bootstrap);
      } else {
        session = await currentAionSession();
        const managed = z.object({ origin: z.string() }).safeParse(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "devhub", "aionui-managed.json"), "utf8")));
        if (!managed.success || session.origin !== managed.data.origin) throw new Error("Connect the installed local workspace in Agents.");
      }
      await applyGraphiteNeonTheme(session);
      try { await ensureAionOpenAiBootstrap(session); } catch { /* Provider bootstrap is best-effort; Agents stays usable. */ }
      try { await ensureAionMcpBootstrap(session); } catch { /* MCP enable is best-effort. */ }
      try {
        const { AionClient } = await import("@/lib/aionui/client");
        const assistants = await new AionClient(session).listAssistants();
        const aionCli = assistants.find((assistant) => assistant.name === DEVHUB_AION_CLI_ASSISTANT_NAME && assistant.enabled && assistant.agent_status === "online");
        if (aionCli) session = await setDefaultAionAssistant(aionCli.id);
      } catch { /* Keep the prior default agent when Aion CLI is offline. */ }
      const response = NextResponse.json({ connected: true, ...publicAionConnection(session) });
      for (const cookie of aionBrowserCookies(session)) response.headers.append("Set-Cookie", cookie);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch {
      // Child errors can contain captured output, including authentication responses.
      return NextResponse.json({ error: `Could not ${input.action === "update" ? "update" : "prepare"} the local workspace. Run npm run agents:install${input.action === "update" ? " -- --update" : ""} in the DevHub checkout for diagnostics.` }, { status: 503 });
    }
  });
}
