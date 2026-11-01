import fs from "node:fs";
import { parseArgs } from "node:util";
import { createCoreServer } from "../http/server";
import { LocalAgentHub } from "../local/ops/transport";
import { closeRequestClaimStorage } from "../domains/storage/request-claims";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    port: { type: "string" }, workspace: { type: "string" }, "pair-file": { type: "string" },
  } });
  const port = Number(values.port);
  const pairFile = values["pair-file"];
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !values.workspace || !pairFile) throw new Error("Missing options");
  const hub = new LocalAgentHub();
  const pairing = hub.pair(values.workspace);
  const server = createCoreServer({ localAgent: { hub, workspaceId: values.workspace } });
  // Exclusive creation avoids overwriting another pairing; credentials never go to stdout.
  fs.writeFileSync(pairFile, JSON.stringify(pairing), { flag: "wx", mode: 0o600 });
  const cleanup = () => {
    hub.close();
    server.close();
    fs.rmSync(pairFile, { force: true });
    void closeRequestClaimStorage();
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) { cleanup(); throw error; }
}

void main().catch(() => {
  console.error("Local-agent core failed. Check --port, --workspace and a new --pair-file path.");
  process.exitCode = 1;
});
