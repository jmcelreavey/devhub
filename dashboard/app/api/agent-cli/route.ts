import { NextRequest, NextResponse } from "next/server";
import {
  isCursorAgentInstalled,
  normalizeAgentCli,
  readAgentCliSettings,
} from "@/lib/agent-cli-env";
import {
  readDashboardEnvLocalFile,
  syncAgentProcessEnvFromOverrides,
  writeDashboardEnvLocalFile,
} from "@/lib/dashboard-env-local";

export const dynamic = "force-dynamic";

/** Agent CLI handoff settings + local cursor-agent availability. */
export async function GET() {
  return NextResponse.json({
    ...readAgentCliSettings(),
    cursorAgentInstalled: isCursorAgentInstalled(),
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    cli?: string;
    opencodeModel?: string;
    cursorModel?: string;
  };

  if (body.cli !== undefined && !["opencode", "cursor"].includes(body.cli.trim().toLowerCase())) {
    return NextResponse.json(
      { ok: false, error: `Unknown agent CLI "${body.cli}" — expected "opencode" or "cursor".` },
      { status: 400 },
    );
  }
  if (body.cli !== undefined && normalizeAgentCli(body.cli) === "cursor" && !isCursorAgentInstalled()) {
    return NextResponse.json(
      { ok: false, error: "cursor-agent is not installed on this machine." },
      { status: 400 },
    );
  }

  const { overrides, passthrough } = readDashboardEnvLocalFile();

  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed) overrides.set(key, trimmed);
    else overrides.delete(key);
  };

  // "opencode" is the default → store nothing so a fresh clone stays clean.
  if (body.cli !== undefined) {
    const cli = normalizeAgentCli(body.cli);
    if (cli === "cursor") overrides.set("DEVHUB_AGENT_CLI", cli);
    else overrides.delete("DEVHUB_AGENT_CLI");
  }
  setOrDelete("DEVHUB_AGENT_OPENCODE_MODEL", body.opencodeModel);
  setOrDelete("DEVHUB_AGENT_CURSOR_MODEL", body.cursorModel);

  writeDashboardEnvLocalFile(overrides, passthrough);
  syncAgentProcessEnvFromOverrides(overrides);

  return NextResponse.json({
    ok: true,
    ...readAgentCliSettings(),
    cursorAgentInstalled: isCursorAgentInstalled(),
  });
}
