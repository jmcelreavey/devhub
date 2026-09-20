import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withMutex } from "@/lib/atomic-write";
import { getRepoRoot } from "@/lib/content/dirs";
import { AionClient } from "./client";
import { aionConnectionId, localAionOrigin, type AionConnection } from "./connection";
import { aionAssistantSchema, aionConversationSchema } from "./contracts";

const sessionSchema = z.object({
  origin: z.string(), userId: z.string(), username: z.string(), anchorConversationId: z.string(),
  accessToken: z.string().min(1), csrfToken: z.string().regex(/^[a-f0-9]{64}$/),
  refreshToken: z.string().min(1), authenticatedAt: z.number(), defaultAssistantId: z.string(),
});
export type AionSession = z.infer<typeof sessionSchema>;

export function aionSessionFile(): string {
  // Authentication is machine-local. Never put it in the tracked notes vault.
  return process.env.DEVHUB_AIONUI_SESSION_FILE?.trim() || path.join(os.homedir(), ".config", "devhub", "aionui-session.json");
}

export function readAionSession(): AionSession | null {
  let raw: string;
  try { raw = fs.readFileSync(aionSessionFile(), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Cannot read the saved AionUi connection.");
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The saved AionUi connection is invalid. Reconnect in Agents."); }
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) throw new Error("The saved AionUi connection is invalid. Reconnect in Agents.");
  localAionOrigin(parsed.data.origin);
  return parsed.data;
}

function saveSession(session: AionSession): void {
  const file = aionSessionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

function cookieValue(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0])
    .find((cookie) => cookie.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function aionHeaders(connection: AionConnection): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(connection.accessToken ? { Authorization: `Bearer ${connection.accessToken}` } : {}),
    ...(connection.csrfToken ? { Cookie: `aionui-csrf-token=${connection.csrfToken}`, "x-csrf-token": connection.csrfToken } : {}),
  };
}

async function request(origin: string, route: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${localAionOrigin(origin)}${route}`, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("AionUi is unavailable. Check its local web address and running service."); }
}

async function data<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw new Error(`AionUi returned HTTP ${response.status}.`);
  const parsed = z.object({ success: z.literal(true), data: schema }).safeParse(await response.json());
  if (!parsed.success) throw new Error("AionUi does not match the supported API contract.");
  return parsed.data.data;
}

export async function connectAion(input: { origin: string; username: string; password: string; assistantId?: string }): Promise<AionSession> {
  const origin = localAionOrigin(input.origin);
  // The upstream convenience launcher uses --local, which bypasses authentication.
  const anonymous = await request(origin, "/api/system/current-user");
  if (anonymous.status !== 401) throw new Error("Start AionCore in authenticated WebUI mode. The unauthenticated local launcher cannot be connected to DevHub.");
  const response = await request(origin, "/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: input.username, password: input.password }),
  });
  if (!response.ok) throw new Error("AionUi sign-in failed. Check the username and password.");
  const parsedLogin = z.object({ success: z.literal(true), token: z.string(), user: z.object({ id: z.string(), username: z.string() }) }).safeParse(await response.json());
  if (!parsedLogin.success) throw new Error("AionUi returned an unsupported sign-in response.");
  const login = parsedLogin.data;
  const csrfToken = cookieValue(response, "aionui-csrf-token");
  const refreshToken = cookieValue(response, "aionui-refresh");
  if (!csrfToken || !refreshToken) throw new Error("AionUi did not return an authenticated WebUI session.");
  const headers = aionHeaders({ origin, userId: login.user.id, anchorConversationId: "", accessToken: login.token, csrfToken });
  let assistants = await data(await request(origin, "/api/assistants", { headers }), z.array(aionAssistantSchema));
  const unchecked = assistants.filter(a => a.enabled && a.agent_status === "unchecked" && a.agent?.source === "builtin");
  if (unchecked.length) {
    // Health checks discover installed native CLIs; they do not submit a prompt.
    const checked = await Promise.allSettled(unchecked.map(a => request(origin, `/api/agents/${encodeURIComponent(a.agent_id)}/health-check`, { method: "POST", headers, body: "{}" })));
    if (checked.every(result => result.status === "rejected")) throw new Error("AionUi could not check the installed agents. Open its Assistants view to finish setup.");
    assistants = await data(await request(origin, "/api/assistants", { headers }), z.array(aionAssistantSchema));
  }
  const assistant = assistants.find((a) => input.assistantId ? a.id === input.assistantId && a.enabled : a.enabled && a.agent_status === "online" && a.agent?.source !== "internal");
  if (!assistant) throw new Error("Enable and check at least one agent in AionUi, then connect again.");
  const existing = readAionSession();
  let anchorConversationId = existing?.origin === origin && existing.userId === login.user.id ? existing.anchorConversationId : undefined;
  if (anchorConversationId) {
    const anchor = await request(origin, `/api/conversations/${encodeURIComponent(anchorConversationId)}`, { headers });
    if (!anchor.ok) anchorConversationId = undefined;
  }
  if (!anchorConversationId) {
    const anchor = await data(await request(origin, "/api/conversations", {
      method: "POST", headers,
      body: JSON.stringify({ name: "DevHub workspace", assistant: { id: assistant.id }, extra: { workspace: getRepoRoot(), custom_workspace: true, devhub: { connection_marker: true } } }),
    }), aionConversationSchema);
    anchorConversationId = anchor.id;
  }
  const session = sessionSchema.parse({ origin, userId: login.user.id, username: login.user.username,
    anchorConversationId, accessToken: login.token, csrfToken, refreshToken, authenticatedAt: Date.now(), defaultAssistantId: assistant.id });
  await new AionClient(session).verifyConnection();
  saveSession(session);
  return session;
}

export async function currentAionSession(): Promise<AionSession> {
  return withMutex(aionSessionFile(), async () => {
    let session = readAionSession();
    if (!session) throw new Error("Connect AionUi in Agents before starting a chat.");
    // Refresh before dispatch, never retry a submitted message on an auth error.
    if (Date.now() - session.authenticatedAt > 15 * 60_000) {
      const response = await request(session.origin, "/api/auth/refresh", {
        method: "POST", headers: aionHeaders(session), body: JSON.stringify({ token: session.refreshToken }),
      });
      if (!response.ok) throw new Error("AionUi sign-in has expired. Reconnect in Agents.");
      const parsedTokens = z.object({ success: z.literal(true), token: z.string(), refresh_token: z.string() }).safeParse(await response.json());
      if (!parsedTokens.success) throw new Error("AionUi returned an unsupported session refresh response.");
      const tokens = parsedTokens.data;
      session = { ...session, accessToken: tokens.token, refreshToken: tokens.refresh_token, authenticatedAt: Date.now() };
      await new AionClient(session).verifyConnection();
      saveSession(session);
    }
    return session;
  });
}

export function publicAionConnection(session: AionSession) {
  return { origin: session.origin, userId: session.userId, username: session.username,
    connectionId: aionConnectionId(session), defaultAssistantId: session.defaultAssistantId };
}

export async function setDefaultAionAssistant(assistantId: string): Promise<AionSession> {
  const session = await currentAionSession();
  const assistants = await new AionClient(session).listAssistants();
  if (!assistants.some(assistant => assistant.id === assistantId && assistant.enabled && assistant.agent_status === "online")) throw new Error("Choose an agent that is ready in AionUi.");
  return withMutex(aionSessionFile(), async () => {
    const latest = readAionSession();
    if (!latest || aionConnectionId(latest) !== aionConnectionId(session)) throw new Error("The workspace changed. Reload before choosing its default agent.");
    const next = { ...latest, defaultAssistantId: assistantId };
    saveSession(next);
    return next;
  });
}

/** Normal AionUi cookies, shared with its same-host iframe; secrets never enter client JSON. */
export function aionBrowserCookies(session: AionSession): string[] {
  const secure = session.origin.startsWith("https:") ? "; Secure" : "";
  return [
    `aionui-session=${session.accessToken}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    `aionui-refresh=${session.refreshToken}; Path=/api/auth/refresh; HttpOnly; SameSite=Lax${secure}`,
    `aionui-csrf-token=${session.csrfToken}; Path=/; SameSite=Lax${secure}`,
  ];
}
