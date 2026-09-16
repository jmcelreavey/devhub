#!/usr/bin/env tsx
/**
 * DevHub MCP HTTP onboarding: ensure a bearer token exists and print
 * ready-to-paste client configs for every harness the user actually runs.
 *
 *   npm run mcp:token
 *
 * Token source matches http.ts exactly: DEVHUB_MCP_HTTP_TOKEN, else the
 * persisted file (generated once, 0600). The printed configs are the whole
 * onboarding — Grok Bot / AutoClaw / any MCP client connects over the URL,
 * stdio clients keep the synced launch config.
 */
import { resolveMcpHttpToken, DEFAULT_MCP_HTTP_PORT, mcpHttpTokenFile } from "./http-auth.ts";

export interface ClientConfigInput {
  port: number;
  host: string;
  token: string;
}

/** Pure so tests can pin the exact shapes clients expect. */
export function renderClientConfigs({ port, host, token }: ClientConfigInput): string {
  const url = `http://${host}:${port}/mcp`;
  const header = `Authorization: Bearer ${token}`;
  const jsonEntry = JSON.stringify(
    {
      type: "http",
      url,
      headers: { Authorization: `Bearer ${token}` },
    },
    null,
    2,
  );
  return [
    `DevHub MCP over Streamable HTTP`,
    `  Endpoint: ${url}`,
    `  Token:    ${token}`,
    `  (persisted in ${mcpHttpTokenFile()}; DEVHUB_MCP_HTTP_TOKEN overrides)`,
    "",
    "1) Generic MCP client (AutoClaw, Grok Bot, anything speaking Streamable HTTP):",
    jsonEntry,
    "",
    "2) Claude Code CLI:",
    `  claude mcp add --transport http devhub ${url} --header "${header}"`,
    "",
    "3) Cursor (~/.cursor/mcp.json → mcpServers.devhub):",
    jsonEntry,
    "",
    "Notes:",
    "- Start it with `npm run mcp:http` in mcp-servers/devhub-server, or just run the dashboard (it starts the HTTP peer automatically).",
    "- Keep the token private: it grants every DevHub tool, including agent dispatch.",
    "- Remote clients (e.g. a Grok Bot box) need a tunnelled URL plus DEVHUB_MCP_HTTP_ALLOWED_HOSTS — narrow the toolset with DEVHUB_MCP_TOOLSETS first.",
  ].join("\n");
}

function main(): void {
  const port = Number.parseInt(process.env.DEVHUB_MCP_HTTP_PORT ?? "", 10) || DEFAULT_MCP_HTTP_PORT;
  const host = process.env.DEVHUB_MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const { token, source } = resolveMcpHttpToken();
  console.error(`Bearer token ${source === "generated" ? "generated and saved" : `loaded (${source})`}.`);
  console.log(renderClientConfigs({ port, host, token }));
}

if (process.argv[1] && process.argv[1].endsWith("token.ts")) main();
