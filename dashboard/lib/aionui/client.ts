import { z } from "zod";
import { localAionOrigin,type AionConnection } from "./connection";
import {
aionAcceptedMessageSchema,aionAssistantSchema,aionConfirmationSchema,aionConversationSchema,
aionMessagePageSchema,aionRuntimeSchema,conversationPayload,type AionConversationInput,
} from "./contracts";
import { modelAllowedForAssistant } from "./dispatch-defaults";

export class AionRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly ambiguous = false) {
    super(message);
    this.name = "AionRequestError";
  }
}

interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** No retries on writes: this release has no request-id idempotency contract. */
export class AionClient {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly connection: AionConnection, options: ClientOptions = {}) {
    this.origin = localAionOrigin(connection.origin);
    if (!connection.userId.trim() || !connection.anchorConversationId.trim()) {
      throw new Error("Verify the AionUi user and history store before connecting.");
    }
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(route: string, schema: z.ZodType<T>, body?: unknown, method?: "POST" | "PUT", allowEmpty = false): Promise<T> {
    const mutating = body !== undefined || method === "POST" || method === "PUT";
    const hasBody = body !== undefined;
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${route}`, {
        method: mutating ? (method ?? "POST") : "GET",
        headers: {
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...(this.connection.accessToken ? { Authorization: `Bearer ${this.connection.accessToken}` } : {}),
          ...(this.connection.csrfToken ? {
            Cookie: `aionui-csrf-token=${this.connection.csrfToken}`,
            "x-csrf-token": this.connection.csrfToken,
          } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Fetch errors can include the target URL or headers. Keep secrets out of run errors.
      throw new AionRequestError(mutating
        ? "AionUi did not acknowledge the request. Check its conversation before retrying."
        : "AionUi is unavailable. Check the local connection.", undefined, mutating);
    }
    if (!response.ok) {
      throw new AionRequestError(`AionUi returned HTTP ${response.status}.`, response.status, mutating && response.status >= 500);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new AionRequestError("AionUi returned an invalid response.", response.status, mutating);
    }
    const envelope = (allowEmpty
      ? z.union([z.object({ success: z.literal(true), data: schema }), z.object({ success: z.literal(true) })])
      : z.object({ success: z.literal(true), data: schema })).safeParse(payload);
    if (!envelope.success) {
      throw new AionRequestError("AionUi's response does not match the pinned API contract.", response.status, mutating);
    }
    return ("data" in envelope.data ? envelope.data.data : undefined) as T;
  }

  async getClientSettings(): Promise<Record<string, unknown>> {
    return this.request("/api/settings/client", z.record(z.string(), z.unknown()));
  }

  async updateClientSettings(settings: Record<string, unknown>): Promise<void> {
    await this.request("/api/settings/client", z.unknown(), settings, "PUT", true);
  }

  async listMcpServers() {
    return this.request("/api/mcp/servers", z.array(z.object({
      id: z.string(), name: z.string(), description: z.string().optional(),
      enabled: z.boolean().optional(), builtin: z.boolean().optional(),
    }).passthrough()));
  }

  async toggleMcpServer(id: string) {
    return this.request(`/api/mcp/servers/${encodeURIComponent(id)}/toggle`, z.object({
      id: z.string(), name: z.string(), enabled: z.boolean().optional(),
    }).passthrough(), {});
  }

  async importMcpServers(servers: Array<Record<string, unknown>>): Promise<void> {
    await this.request("/api/mcp/servers/import", z.unknown(), { servers }, "POST", true);
  }

  async updateMcpServer(id: string, data: Record<string, unknown>): Promise<void> {
    await this.request(`/api/mcp/servers/${encodeURIComponent(id)}`, z.unknown(), data, "PUT", true);
  }

  async deleteMcpServer(id: string): Promise<void> {
    const response = await this.fetcher(`${this.origin}/api/mcp/servers/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: {
        Accept: "application/json",
        ...(this.connection.accessToken ? { Authorization: `Bearer ${this.connection.accessToken}` } : {}),
        ...(this.connection.csrfToken ? { Cookie: `aionui-csrf-token=${this.connection.csrfToken}`, "x-csrf-token": this.connection.csrfToken } : {}),
      }, signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new AionRequestError(`AionUi returned HTTP ${response.status}.`, response.status);
  }

  async verifyConnection() {
    const user = await this.request("/api/system/current-user", z.object({ id: z.string(), username: z.string() }));
    if (user.id !== this.connection.userId) throw new AionRequestError("AionUi is serving a different user. Reconnect in setup.");
    // Local mode's user ID is fixed across databases, so an identity echo alone is insufficient.
    await this.getConversation(this.connection.anchorConversationId);
    return { userId: user.id };
  }

  async listAssistants() {
    await this.verifyConnection();
    return this.request("/api/assistants", z.array(aionAssistantSchema));
  }

  getConversation(id: string) {
    return this.request(`/api/conversations/${encodeURIComponent(id)}`, aionConversationSchema);
  }

  async listConversations(cursor?: string) {
    await this.verifyConnection();
    const query = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
    return this.request(`/api/conversations?${query}`, z.object({
      items: z.array(aionConversationSchema), total: z.number(), has_more: z.boolean(),
    }));
  }

  async createConversation(input: AionConversationInput) {
    const assistants = await this.listAssistants();
    const assistant = assistants.find((item) => item.id === input.assistantId);
    if (!assistant?.enabled || assistant.agent_status !== "online") {
      throw new AionRequestError("The selected agent is not ready in AionUi.");
    }
    if (!modelAllowedForAssistant(assistant, input.model)) {
      throw new AionRequestError("This model is not advertised by the selected AionUi assistant.");
    }
    return this.request("/api/conversations", aionConversationSchema, conversationPayload(input));
  }

  async sendMessage(conversationId: string, content: string) {
    await this.verifyConnection();
    const conversation = await this.getConversation(conversationId);
    if (!conversation.runtime?.can_send_message || conversation.runtime.is_processing || conversation.runtime.turn_id) {
      throw new AionRequestError("This conversation is busy or awaiting attention. Open it before sending another turn.");
    }
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, aionAcceptedMessageSchema, { content });
  }

  getMessages(conversationId: string, after?: string, anchorMessageId?: string) {
    const query = new URLSearchParams({ limit: "100", ...(after ? { after } : {}), ...(anchorMessageId ? { anchor_message_id: anchorMessageId } : {}) });
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${query}`, aionMessagePageSchema);
  }

  async listConfirmations(conversationId: string) {
    return this.request(
      `/api/conversations/${encodeURIComponent(conversationId)}/confirmations`,
      z.array(aionConfirmationSchema),
    );
  }

  /** Prefer allow-always so Cursor does not re-prompt the same tool class mid-run. */
  async confirmPermission(conversationId: string, callId: string, data = "allow-always") {
    return this.request(
      `/api/conversations/${encodeURIComponent(conversationId)}/confirmations/${encodeURIComponent(callId)}/confirm`,
      z.unknown(),
      { msg_id: callId, data, always_allow: data === "allow-always" },
      "POST",
      true,
    );
  }

  async listManagedEnabledMcpIds(): Promise<string[]> {
    const servers = await this.listMcpServers();
    return servers
      .filter((item) => item.enabled !== false && !item.builtin && item.description?.startsWith("[DevHub managed]"))
      .map((item) => item.id);
  }

  /** Enabled non-builtin AionUi MCP servers, optionally narrowed for a workflow. */
  async listEnabledMcpIds(names?: readonly string[]): Promise<string[]> {
    const servers = await this.listMcpServers();
    const allowed = names ? new Set(names) : null;
    return servers
      .filter((item) => item.enabled !== false && !item.builtin && (!allowed || allowed.has(item.name)))
      .map((item) => item.id);
  }

  async cancelTurn(conversationId: string, turnId: string) {
    await this.verifyConnection();
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/cancel`,
      z.object({ runtime: aionRuntimeSchema }), { turn_id: turnId });
  }

  async listProviders() {
    return this.request("/api/providers", z.array(z.object({
      id: z.string(), platform: z.string(), name: z.string(),
      models: z.array(z.string()).optional(), enabled: z.boolean().optional(),
    }).passthrough()));
  }

  createProvider(body: Record<string, unknown>) {
    return this.request("/api/providers", z.object({ id: z.string() }).passthrough(), body);
  }

  async updateProvider(id: string, body: Record<string, unknown>): Promise<void> {
    await this.request(`/api/providers/${encodeURIComponent(id)}`, z.unknown(), body, "PUT", true);
  }

  /** Hide a finished chat from the active AionUi sidebar. 404 = already archived/gone. */
  async archiveConversation(conversationId: string): Promise<void> {
    await this.request(
      `/api/sidebar/conversation/${encodeURIComponent(conversationId)}/archive`,
      z.unknown(),
      undefined,
      "POST",
      true,
    );
  }

}
