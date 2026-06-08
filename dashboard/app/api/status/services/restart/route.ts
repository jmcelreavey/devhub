import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { cleanOpenChamberEnv, resolveOpenChamberCommand } from "@/lib/openchamber-command";
import {
  resolveOpenCodeBinary,
  getOpenCodeEnv,
  resolveOpenCodeBindHost,
  resolveOpenCodePort,
} from "@/lib/opencode-command";
import { DEV_SERVICES } from "@/lib/dev-services";

const CHAMBER_PORT = Number.parseInt(process.env.OPENCHAMBER_PORT ?? "1336", 10);
const CHAMBER_HOST = process.env.OPENCHAMBER_HOST ?? "0.0.0.0";

function runOpenChamber(args: string[]): Promise<{ code: number | null; output: string }> {
  const { cmd, argsPrefix } = resolveOpenChamberCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...argsPrefix, ...args], { env: cleanOpenChamberEnv() });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

/** Kill any process listening on the given port (macOS/Linux). */
async function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const lsof = spawn("lsof", ["-ti", "-sTCP:LISTEN", `tcp:${port}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    lsof.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    lsof.on("close", () => {
      for (const pid of out.trim().split("\n").filter(Boolean)) {
        try { process.kill(Number.parseInt(pid, 10), "SIGTERM"); } catch { /* already gone */ }
      }
      resolve();
    });
    lsof.on("error", () => resolve());
  });
}

async function restartOpenChamber(): Promise<NextResponse> {
  await runOpenChamber(["stop", "--port", String(CHAMBER_PORT), "--quiet"]).catch(() => null);
  const started = await runOpenChamber([
    "serve",
    "--port", String(CHAMBER_PORT),
    "--host", CHAMBER_HOST,
    "--quiet",
  ]);
  if (started.code !== 0) {
    return NextResponse.json(
      { error: "Failed to restart OpenChamber", output: started.output.trim() },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, restarted: true });
}

async function restartOpenCode(): Promise<NextResponse> {
  const port = resolveOpenCodePort();
  const bindHost = resolveOpenCodeBindHost();
  await killProcessOnPort(port);
  // Give the OS a moment to release the port.
  await new Promise((r) => setTimeout(r, 300));

  const binary = resolveOpenCodeBinary();
  const child = spawn(
    binary,
    ["serve", "--port", String(port), "--hostname", bindHost],
    { detached: true, stdio: "ignore", env: getOpenCodeEnv() },
  );
  child.unref();

  return NextResponse.json({ ok: true, restarted: true });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const service = body?.service ?? body?.unit;

  const known = DEV_SERVICES.map((s) => s.id);
  if (!known.includes(service)) {
    return NextResponse.json(
      { error: "Unknown service", known },
      { status: 400 },
    );
  }

  if (service === "openchamber") return restartOpenChamber();
  if (service === "opencode") return restartOpenCode();

  return NextResponse.json({ error: "Unhandled service" }, { status: 500 });
}
