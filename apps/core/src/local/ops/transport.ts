import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { localOperationRequest, localOperationResponse } from "../../../../../packages/shared/local-ops";
import { requestContext } from "./context";
import type { LocalOps, LocalRunOptions, LocalRunResult } from "./index";

export interface LocalAgentPairing { workspaceId: string; secret: string }
interface Pending {
  resolve: (result: LocalRunResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Connection { socket: WebSocket; pending: Map<string, Pending> }

const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** One-use pairing for one trusted operator; no public pairing endpoint. */
/**
 * Only variables a caller sets or changes leave the server; the agent keeps its
 * own environment for everything else, so server secrets are never forwarded.
 */
export function remoteEnvDelta(env: NodeJS.ProcessEnv | undefined, base: NodeJS.ProcessEnv = process.env): Record<string, string> | undefined {
  if (!env || env === base) return undefined;
  const delta = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && base[entry[0]] !== entry[1]));
  return Object.keys(delta).length ? delta : undefined;
}

export class LocalAgentHub {
  private readonly pairings = new Map<string, { workspaceId: string; expires: number }>();
  private readonly connections = new Map<string, Connection>();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  pair(workspaceId: string): LocalAgentPairing {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(workspaceId)) throw new Error("Invalid workspaceId");
    if (this.connections.has(workspaceId)) throw new Error("Workspace already connected");
    for (const [key, value] of this.pairings) {
      if (value.expires <= Date.now() || value.workspaceId === workspaceId) this.pairings.delete(key);
    }
    if (this.pairings.size >= 32) throw new Error("Too many pending pairings");
    const secret = randomBytes(32).toString("base64url");
    this.pairings.set(digest(secret), { workspaceId, expires: Date.now() + 300_000 });
    return { workspaceId, secret };
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const authorization = request.headers.authorization;
      const key = typeof authorization === "string" && /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)
        ? digest(authorization.slice(7)) : "";
      const pairing = this.pairings.get(key);
      if (request.url !== "/local-agent" || request.headers.origin || !pairing || pairing.expires <= Date.now() || this.connections.has(pairing.workspaceId)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      this.pairings.delete(key);
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.accept(pairing.workspaceId, ws));
    });
    server.once("close", () => this.close());
  }

  private accept(workspaceId: string, socket: WebSocket): void {
    const connection: Connection = { socket, pending: new Map() };
    this.connections.set(workspaceId, connection);
    const disconnect = () => {
      if (this.connections.get(workspaceId) === connection) this.connections.delete(workspaceId);
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Local agent disconnected; operation was not replayed"));
      }
      connection.pending.clear();
    };
    socket.on("close", disconnect);
    socket.on("error", () => { disconnect(); socket.terminate(); });
    socket.on("message", (data, binary) => {
      try {
        if (binary) throw new Error("Invalid response");
        const response = localOperationResponse.parse(JSON.parse(data.toString()));
        const pending = connection.pending.get(response.id);
        if (!pending) throw new Error("Unknown request");
        connection.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error !== undefined) pending.reject(new Error(response.error));
        else pending.resolve(response.result!);
      } catch { socket.terminate(); }
    });
  }

  private async run(cli: string, args: readonly string[], options: LocalRunOptions = {}): Promise<LocalRunResult> {
    const workspaceId = requestContext()?.workspaceId;
    if (!workspaceId) throw new Error("Remote local operations require a workspace context");
    // Process handles, callbacks and binary IO are deliberately local-only.
    if (Object.entries(options).some(([key, value]) => value !== undefined && !["cwd", "env", "timeoutMs", "maxBuffer", "collect"].includes(key))) {
      throw new Error("Unsupported remote local-op options");
    }
    const parsed = localOperationRequest.safeParse({ id: randomUUID(), workspaceId, cli, args, options: {
      cwd: options.cwd, env: remoteEnvDelta(options.env), timeoutMs: options.timeoutMs, maxBuffer: options.maxBuffer,
    } });
    // Schema diagnostics can include environment keys or values.
    if (!parsed.success) throw new Error("Invalid local operation request");
    const request = parsed.data;
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload) > 65_536) throw new Error("Local operation request is too large");
    const connection = this.connections.get(workspaceId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) throw new Error("Local agent is not connected");
    if (connection.pending.size >= 16) throw new Error("Local agent is busy");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out command has an unknown outcome; disconnect and never replay it.
        connection.socket.terminate();
      }, request.options.timeoutMs + 1000);
      connection.pending.set(request.id, { resolve, reject, timer });
      connection.socket.send(payload, (error) => { if (error) connection.socket.terminate(); });
    });
  }

  readonly ops: Pick<LocalOps, "run" | "git"> = {
    run: (cli, args, options) => this.run(cli, args, options),
    git: (op, args, options = {}) => {
      const { executable, ...rest } = options;
      return this.run(executable ?? "git", op === undefined ? args : [op, ...args], rest);
    },
  };

  close(): void {
    this.pairings.clear();
    for (const connection of this.connections.values()) connection.socket.terminate();
    this.sockets.close();
  }
}
