import { agentCliGet, agentCliPut } from "../../../../../../packages/shared/actions/agent-cli";
import {
  isCursorAgentInstalled,
  normalizeAgentCli,
  readAgentCliSettings,
  type AgentCli,
} from "../../../lib/agent/cli-env";
import {
  aiProviderLabel,
  isAntigravityCliInstalled,
  isChatgptCliInstalled,
  normalizeAiProvider,
  readConfiguredAiProvider,
  resolveAgentLaunchCli,
  resolveAiProvider,
  toAgentLaunchCli,
  type AiProviderId,
} from "../../../lib/ai/preference";
import { isNotesAiConfigured } from "../../../lib/notes-ai/config";
import { isOpenCodeConfigured } from "../../../lib/peer-service-availability";
import { listCursorAgentModels } from "../../../lib/ai/cursor-models";
import { listPaseoProviders } from "../../../lib/paseo/providers";
import {
  readDashboardEnvLocalFile,
  syncAgentProcessEnvFromOverrides,
  writeDashboardEnvLocalFile,
} from "../../../lib/dashboard-env-local";


async function providerPayload() {
  const settings = readAgentCliSettings();
  const resolved = await resolveAiProvider();
  const [cursorModels, paseoProviders] = await Promise.all([
    listCursorAgentModels().catch(() => []),
    listPaseoProviders().catch(() => []),
  ]);
  const paseoIds: Partial<Record<AiProviderId, string>> = {
    "chatgpt-cli": "codex",
    "antigravity-cli": "gemini",
    opencode: "opencode",
  };
  const models: Partial<Record<AiProviderId, string[]>> = {
    ...(cursorModels.length ? { "cursor-cli": cursorModels } : {}),
  };
  for (const [provider, paseoId] of Object.entries(paseoIds) as [AiProviderId, string][]) {
    const available = paseoProviders.find((row) => row.id === paseoId)?.models ?? [];
    if (available.length) models[provider] = available;
  }
  return {
    ...settings,
    // Effective launch CLI for the resolved provider (not a stale DEVHUB_AGENT_CLI).
    cli: await resolveAgentLaunchCli(resolved),
    provider: readConfiguredAiProvider(),
    resolvedProvider: resolved.provider,
    fallback: resolved.fallback,
    setupHint: resolved.setupHint,
    cursorAgentInstalled: resolved.availability["cursor-cli"],
    chatgptCliInstalled: isChatgptCliInstalled(),
    antigravityCliInstalled: isAntigravityCliInstalled(),
    apiConfigured: isNotesAiConfigured(),
    opencodeInstalled: isOpenCodeConfigured(),
    availability: resolved.availability,
    models,
  };
}

/** AI provider + agent CLI handoff settings and local CLI availability. */
export async function GET() {
  return Response.json(await agentCliGet.handler(agentCliGet.input.parse({}), { execute: providerPayload }));
}

function launchCliForProvider(provider: AiProviderId): AgentCli | null {
  if (provider === "api") return null;
  return toAgentLaunchCli(provider);
}

export async function PUT(req: Request) {
  const input = agentCliPut.input.parse({ body: await req.json() });
  return await agentCliPut.handler(input, { execute: ({ body }) => saveAgentCli(body) }) as Response;
}

async function saveAgentCli(rawBody: unknown) {
  const body = rawBody as {
    cli?: string;
    provider?: string;
    opencodeModel?: string;
    cursorModel?: string;
    antigravityModel?: string;
  };

  const providerRaw =
    body.provider !== undefined
      ? normalizeAiProvider(body.provider)
      : body.cli !== undefined
        ? normalizeAiProvider(body.cli)
        : undefined;

  if (body.provider !== undefined && body.provider.trim() && !providerRaw) {
    return Response.json(
      {
        ok: false,
        error: `Unknown AI provider "${body.provider}" — expected cursor-cli, chatgpt-cli, antigravity-cli, opencode, or api.`,
      },
      { status: 400 },
    );
  }

  if (body.cli !== undefined && body.provider === undefined) {
    if (!["opencode", "cursor", "chatgpt", "antigravity"].includes(body.cli.trim().toLowerCase())) {
      return Response.json(
        {
          ok: false,
          error: `Unknown agent CLI "${body.cli}" — expected "opencode", "cursor", "chatgpt", or "antigravity".`,
        },
        { status: 400 },
      );
    }
  }

  if (providerRaw === "cursor-cli" && !(await isCursorAgentInstalled())) {
    return Response.json(
      { ok: false, error: "cursor-agent is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "chatgpt-cli" && !isChatgptCliInstalled()) {
    return Response.json(
      { ok: false, error: "ChatGPT / Codex CLI is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "antigravity-cli" && !isAntigravityCliInstalled()) {
    return Response.json(
      { ok: false, error: "Antigravity CLI (agy) is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "opencode" && !isOpenCodeConfigured()) {
    return Response.json(
      { ok: false, error: "opencode is not installed on this machine." },
      { status: 400 },
    );
  }
  if (providerRaw === "api" && !isNotesAiConfigured()) {
    return Response.json(
      { ok: false, error: "AI_API_KEY is not set — configure the HTTP API key first." },
      { status: 400 },
    );
  }

  if (body.cli !== undefined && body.provider === undefined) {
    const cli = normalizeAgentCli(body.cli);
    if (cli === "cursor" && !(await isCursorAgentInstalled())) {
      return Response.json(
        { ok: false, error: "cursor-agent is not installed on this machine." },
        { status: 400 },
      );
    }
    if (cli === "chatgpt" && !isChatgptCliInstalled()) {
      return Response.json(
        { ok: false, error: "ChatGPT / Codex CLI is not installed on this machine." },
        { status: 400 },
      );
    }
    if (cli === "antigravity" && !isAntigravityCliInstalled()) {
      return Response.json(
        { ok: false, error: "Antigravity CLI (agy) is not installed on this machine." },
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
    if (launch === "cursor" || launch === "chatgpt" || launch === "antigravity") {
      overrides.set("DEVHUB_AGENT_CLI", launch);
    } else if (launch === "opencode") {
      overrides.delete("DEVHUB_AGENT_CLI");
    }
    // api → keep existing agent CLI for tool jobs; only set provider
  } else if (body.cli !== undefined) {
    const cli = normalizeAgentCli(body.cli);
    if (cli === "cursor" || cli === "chatgpt" || cli === "antigravity") overrides.set("DEVHUB_AGENT_CLI", cli);
    else overrides.delete("DEVHUB_AGENT_CLI");
    // Mirror into the shared preference when saving via legacy cli field
    if (cli === "cursor") overrides.set("DEVHUB_AI_PROVIDER", "cursor-cli");
    else if (cli === "chatgpt") overrides.set("DEVHUB_AI_PROVIDER", "chatgpt-cli");
    else if (cli === "antigravity") overrides.set("DEVHUB_AI_PROVIDER", "antigravity-cli");
    else overrides.set("DEVHUB_AI_PROVIDER", "opencode");
  }

  setOrDelete("DEVHUB_AGENT_OPENCODE_MODEL", body.opencodeModel);
  setOrDelete("DEVHUB_AGENT_CURSOR_MODEL", body.cursorModel);
  setOrDelete("DEVHUB_AGENT_ANTIGRAVITY_MODEL", body.antigravityModel);

  writeDashboardEnvLocalFile(overrides, passthrough);
  syncAgentProcessEnvFromOverrides(overrides);

  return Response.json({
    ok: true,
    ...(await providerPayload()),
    label: providerRaw ? aiProviderLabel(providerRaw) : undefined,
  });
}
