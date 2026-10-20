import path from "node:path";
import { SlackGateway } from "./gateway.ts";
import { Registry } from "./registry.ts";
import { slackLayer, socketSlack } from "./slack.ts";
import { requireSsoOff } from "./sso.ts";

let cleanup: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  requireSsoOff();
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const mode = process.env.GATEWAY_SLACK_MODE ?? "socket";
  if (!["socket", "events"].includes(mode) || !botToken || (mode === "socket" && !appToken) || (mode === "events" && !process.env.SLACK_SIGNING_SECRET)) throw new Error("Slack configuration missing");
  const gateway = new SlackGateway({
    registry: new Registry(path.join(process.env.GATEWAY_DATA_DIR ?? "./data", "registry.json")),
    slack: await slackLayer(botToken),
    admins: (process.env.GATEWAY_ADMINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    trustProxy: process.env.GATEWAY_TRUST_PROXY === "1",
    ...(mode === "events" ? { signingSecret: process.env.SLACK_SIGNING_SECRET } : {}),
    log: (metadata) => console.info(JSON.stringify(metadata)),
  });
  const socket = mode === "socket" ? socketSlack(appToken!, gateway) : undefined;
  let stopping = false;
  cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await gateway.close();
    await socket?.disconnect();
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
    void cleanup?.().catch(() => { console.error(JSON.stringify({ kind: "shutdown_failed" })); process.exitCode = 1; });
  });
  await gateway.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? "0.0.0.0");
  await socket?.start();
}

void main().catch(async () => {
  console.error(JSON.stringify({ kind: "startup_failed" }));
  process.exitCode = 1;
  try { await cleanup?.(); }
  catch { console.error(JSON.stringify({ kind: "shutdown_failed" })); }
});
