import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { localOperationRequest } from "../../../../../packages/shared/local-ops";
import { inProcessLocalOps, type LocalOps } from "./index";
import { withRequestContext } from "./context";
import type { LocalAgentPairing } from "./transport";

/** The paired core is trusted to run commands as this OS user. This is not a sandbox. */
export async function connectLocalAgent(url: string, pairing: LocalAgentPairing, root: string, ops: Pick<LocalOps, "run"> = inProcessLocalOps): Promise<WebSocket> {
  const target = new URL(url);
  if (target.username || target.password || target.search || target.hash || target.pathname !== "/local-agent"
    || (target.protocol !== "wss:" && !(target.protocol === "ws:" && target.hostname === "127.0.0.1"))) {
    throw new Error("Local agent requires wss (ws is allowed only on 127.0.0.1)");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairing.secret) || !/^[a-zA-Z0-9_-]{1,200}$/.test(pairing.workspaceId)) throw new Error("Invalid pairing");
  const directory = fs.realpathSync(root);
  const socket = new WebSocket(target, { headers: { Authorization: `Bearer ${pairing.secret}` }, maxPayload: 65_536, handshakeTimeout: 5000, followRedirects: false });
  const running = new Map<string, AbortController>();
  const stop = () => { for (const controller of running.values()) controller.abort(); };
  socket.on("close", stop);
  socket.on("error", stop);
  socket.on("message", (data, binary) => {
    void (async () => {
      let id: string | undefined;
      try {
        if (binary) throw new Error("Invalid request");
        const request = localOperationRequest.parse(JSON.parse(data.toString()));
        if (request.workspaceId !== pairing.workspaceId || running.has(request.id) || running.size >= 16) throw new Error("Invalid workspace or request");
        id = request.id;
        const cwd = fs.realpathSync(path.resolve(directory, request.options.cwd ?? "."));
        const relative = path.relative(directory, cwd);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Invalid working directory");
        const controller = new AbortController();
        running.set(id, controller);
        const result = await withRequestContext({ workspaceId: request.workspaceId }, () => ops.run(request.cli, request.args, {
          ...request.options, env: request.options.env ? { ...process.env, ...request.options.env } : undefined, cwd, collect: true, signal: controller.signal,
        }));
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, result: { stdout: result.stdout, stderr: result.stderr } }));
      } catch {
        // Command errors can contain credentials or command arguments. Keep them off the wire.
        if (id && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, error: "Local operation failed" }));
        else socket.terminate();
      } finally {
        if (id) running.delete(id);
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", () => reject(new Error("Local agent connection failed")));
    socket.once("close", () => reject(new Error("Local agent connection closed")));
  });
  return socket;
}
