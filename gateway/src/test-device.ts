import { sign } from "node:crypto";
import { WebSocket } from "ws";
import type { GatewayCapability, GatewayServerMessage } from "../../shared/slack-gateway/protocol.ts";

export class TestDevice {
  readonly socket: WebSocket;
  readonly messages: GatewayServerMessage[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (data) => { this.messages.push(JSON.parse(data.toString()) as GatewayServerMessage); for (const listener of this.listeners) listener(); });
    this.socket.on("error", () => {});
  }

  next<Type extends GatewayServerMessage["type"]>(type: Type): Promise<Extract<GatewayServerMessage, { type: Type }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error(`No ${type} response`)); }, 3000);
      const check = () => {
        const index = this.messages.findIndex((message) => message.type === type);
        if (index < 0) return;
        clearTimeout(timer); this.listeners.delete(check);
        resolve(this.messages.splice(index, 1)[0] as Extract<GatewayServerMessage, { type: Type }>);
      };
      this.listeners.add(check); check();
    });
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  async authenticate(deviceId: string, privateKey: string, capabilities: GatewayCapability[] = ["ask", "handoff"]): Promise<void> {
    const challenge = await this.next("challenge");
    const timestamp = Date.now();
    this.send({ type: "auth", deviceId, timestamp, signature: sign(null, Buffer.from(`${challenge.nonce}|${deviceId}|${timestamp}`), privateKey).toString("base64"), capabilities });
  }
}
