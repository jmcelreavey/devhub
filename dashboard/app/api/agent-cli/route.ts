import { NextRequest, NextResponse } from "next/server";
import {
  isCursorAgentInstalled,
  normalizeAgentCli,
  readAgentCliSettings,
  type AgentCli,
} from "@/lib/agent/cli-env";
import {
  aiProviderLabel,
  isChatgptCliInstalled,
  normalizeAiProvider,
  readConfiguredAiProvider,
  resolveAgentLaunchCli,
  resolveAiProvider,
  toAgentLaunchCli,
  type AiProviderId,
} from "@/lib/ai/preference";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { isOpenCodeConfigured } from "@/lib/peer-service-availability";
import {
  readDashboardEnvLocalFile,
  syncAgentProcessEnvFromOverrides,
  writeDashboardEnvLocalFile,
} from "@/lib/dashboard-env-local";

export const dynamic = "force-dynamic";

function providerPayload() {
  const settings = readAgentCliSettings();
  const resolved = resolveAiProvider();
  return {
    ...settings,
    // Effective launch CLI for the resolved provider (not a stale DEVHUB_AGENT_CLI).
    cli: resolveAgentLaunchCli(resolved),
    provider: readConfiguredAiProvider(),
    resolvedProvider: resolved.provider,
    fallback: resolved.fallback,
    setupHint: resolved.setupHint,
    cursorAgentInstalled: isCursorAgentInstalled(),
    chatgptCliInstalled: isChatgptCliInstalled(),
    apiConfigured: isNotesAiConfigured(),
    opencodeInstalled: isOpenCodeConfigured(),
    availability: resolved.availability,
  };
}

/** AI provider + agent CLI handoff settings and local CLI availability. */
export async function GET() {
  return NextResponse.json(providerPayload());
}

function launchCliForProvider(provider: AiProviderId): AgentCli | null {
  if (provider === "api") return null;
  return toAgentLaunchCli(provider);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    cli?: string;
    provider?: string;
    opencodeModel?: string;
    cursorModel?: string;
  };

  const providerRaw =
    body.provider !== undefined
      ? normalizeAiProvider(body.provider)
      : body.cli !== undefined
        ? normalizeAiProvider(body.cli)
        : undefined;

  if (body.provider !== undefined && body.provider.trim() && !providerRaw) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown AI provider "${body.provider}" — expected cursor-cli, chatgpt-cli, opencode, or api.`,
      },
      { status: 400 },
    );
  }

  if (body.cli !== undefined && body.provider === undefined) {
    if (!["opencode", "cursor", "chatgpt"].includes(body.cli.trim().toLowerCase())) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unknown agent CLI "${body.cli}" — expected "opencode", "cursor", or "chatgpt".`,
        },
        { status: 400 },
      );
    }
  }

  if (providerRaw === "cursor-cli" && !isCursorAgentInstalled()) {
    return NextResponse.json(
      { ok: false, error: "cursor-agent is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "chatgpt-cli" && !isChatgptCliInstalled()) {
    return NextResponse.json(
      { ok: false, error: "ChatGPT / Codex CLI is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "opencode" && !isOpenCodeConfigured()) {
    return NextResponse.json(
      { ok: false, error: "opencode is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "api" && !isNotesAiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI_API_KEY is not set — configure the HTTP API key first." },
      { status: 400 },
    );
  }

  if (body.cli !== undefined && body.provider === undefined) {
    const cli = normalizeAgentCli(body.cli);
    if (cli === "cursor" && !isCursorAgentInstalled()) {
      return NextResponse.json(
        { ok: false, error: "cursor-agent is not installed on this machine." },
        { status: 400 },
      );
    }
    if (cli === "chatgpt" && !isChatgptCliInstalled()) {
      return NextResponse.json(
        { ok: false, error: "ChatGPT / Codex CLI is not installed on this machine." },
        { status: 400 },
      );
    }
  }

  const { overrides, passthrough } = readDashboardEnvLocalFile();

  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed) overrides.set(key, trimmed);
    else overrides.delete(key);
  };

  if (providerRaw) {
    overrides.set("DEVHUB_AI_PROVIDER", providerRaw);
    const launch = launchCliForProvider(providerRaw);
    if (launch === "cursor" || launch === "chatgpt") {
      overrides.set("DEVHUB_AGENT_CLI", launch);
    } else if (launch === "opencode") {
      overrides.delete("DEVHUB_AGENT_CLI");
    }
    // api → keep existing agent CLI for tool jobs; only set provider
  } else if (body.cli !== undefined) {
    const cli = normalizeAgentCli(body.cli);
    if (cli === "cursor" || cli === "chatgpt") overrides.set("DEVHUB_AGENT_CLI", cli);
    else overrides.delete("DEVHUB_AGENT_CLI");
    // Mirror into the shared preference when saving via legacy cli field
    if (cli === "cursor") overrides.set("DEVHUB_AI_PROVIDER", "cursor-cli");
    else if (cli === "chatgpt") overrides.set("DEVHUB_AI_PROVIDER", "chatgpt-cli");
    else overrides.set("DEVHUB_AI_PROVIDER", "opencode");
  }

  setOrDelete("DEVHUB_AGENT_OPENCODE_MODEL", body.opencodeModel);
  setOrDelete("DEVHUB_AGENT_CURSOR_MODEL", body.cursorModel);

  writeDashboardEnvLocalFile(overrides, passthrough);
  syncAgentProcessEnvFromOverrides(overrides);

  return NextResponse.json({
    ok: true,
    ...providerPayload(),
    label: providerRaw ? aiProviderLabel(providerRaw) : undefined,
  });
}
