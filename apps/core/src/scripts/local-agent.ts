import fs from "node:fs";
import { parseArgs } from "node:util";
import { connectLocalAgent } from "../local/ops/agent";
import type { LocalAgentPairing } from "../local/ops/transport";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    connect: { type: "string" }, "pair-file": { type: "string" }, root: { type: "string" },
  } });
  if (!values.connect || !values["pair-file"] || !values.root) throw new Error("Missing options");
  const pairing = JSON.parse(fs.readFileSync(values["pair-file"], "utf8")) as LocalAgentPairing;
  const socket = await connectLocalAgent(values.connect, pairing, values.root);
  process.once("SIGINT", () => socket.close());
  process.once("SIGTERM", () => socket.close());
  socket.once("close", () => { process.exitCode = 1; });
}

void main().catch(() => {
  console.error("Local agent failed. Check --connect, --pair-file and --root; pair again after a disconnect.");
  process.exitCode = 1;
});
