/**
 * DevHub's agent runtime. DevHub owns runs (dispatch rules, worktrees, records);
 * the Paseo daemon owns the harness processes, sessions and chat UI.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPaseoApi, type PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { describeAgentSetup } from "./agent-setup";
import { PaseoUserError } from "./user-message";

const DEFAULT_URL = "ws://127.0.0.1:6767/ws";

/** Loopback only: the daemon runs agents with full access, so never dial it remotely by accident. */
export function paseoUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DEVHUB_PASEO_URL?.trim() || DEFAULT_URL;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("DEVHUB_PASEO_URL is not a valid URL."); }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("DEVHUB_PASEO_URL must be a ws:// or wss:// URL.");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("DEVHUB_PASEO_URL must point at a loopback daemon.");
  return url.toString();
}

/** Web UI origin for deep links: the daemon serves it from the same address as the API. */
export function paseoWebOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(paseoUrl(env));
  return `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}`;
}

/** OPENCHAMBER_UI_PASSWORD is the legacy name, from when OpenChamber owned this password. */
export function paseoPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.DEVHUB_PASEO_PASSWORD?.trim() || env.OPENCHAMBER_UI_PASSWORD?.trim();
  if (configured) return configured;
  try { return fs.readFileSync(path.join(os.homedir(), ".config", "devhub", "paseo-password"), "utf8").trim() || undefined; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export interface PaseoSession {
  api: PaseoApi;
  daemon: DaemonClient;
}

/**
 * One short-lived connection per operation. Route handlers and the reconcile
 * tick are independent callers; a shared socket would need its own lifecycle
 * and reconnect story for little gain at this call rate.
 */
export async function withPaseo<T>(fn: (session: PaseoSession) => Promise<T>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const password = paseoPassword(env);
  const daemon = new DaemonClient({
    url: paseoUrl(env),
    // Paseo resumes sessions by clientId; sharing one would replace concurrent sockets.
    clientId: `devhub-dashboard-${randomUUID()}`,
    ...(password ? { password } : {}),
    reconnect: { enabled: false },
    connectTimeoutMs: 10_000,
  });
  try {
    await daemon.connect();
  } catch {
    await daemon.close().catch(() => undefined);
    const running = await fetch(`${paseoWebOrigin(env)}/api/health`, { signal: AbortSignal.timeout(2_000) }).then((response) => response.ok).catch(() => false);
    if (running) throw new PaseoUserError("Paseo is running, but DevHub could not connect. Enter its existing Agents password in Setup, then retry. You do not need to reinstall it.");
    const help = describeAgentSetup(false);
    const unavailable = new PaseoUserError(help.message);
    unavailable.detail = help.detail;
    unavailable.setupHref = help.setupHref;
    throw unavailable;
  }
  try {
    return await fn({ api: createPaseoApi(daemon), daemon });
  } finally {
    await daemon.close().catch(() => undefined);
  }
}

/**
 * Web UI link for an agent. `/h/<server>/agent/<id>` doesn't survive a cold
 * load; the workspace URL does, and opens with the agent's tab selected.
 */
export async function paseoAgentWebUrl(agentId: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const origin = paseoWebOrigin(env);
  const password = paseoPassword(env);
  const response = await fetch(`${origin}/api/status`, {
    headers: password ? { Authorization: `Bearer ${password}` } : {},
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Paseo returned HTTP ${response.status} for its status.`);
  const { serverId } = (await response.json()) as { serverId?: unknown };
  if (typeof serverId !== "string" || !/^srv_[A-Za-z0-9_-]+$/.test(serverId)) throw new Error("Paseo did not report a server id.");
  const fetched = await withPaseo(({ daemon }) => daemon.fetchAgent(agentId), env);
  const workspaceId = fetched?.agent.workspaceId;
  if (!workspaceId) return null;
  return `${origin}/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`agent:${agentId}`)}`;
}
