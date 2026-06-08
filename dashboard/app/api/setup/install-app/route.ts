import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { isSameOrigin } from "@/lib/api-utils";
import { augmentedPathEnv } from "@/lib/process-env";
import {
  placeArtifact,
  releaseDir,
  repoRoot,
  resolveBuiltArtifact,
  wrapperDepsInstalled,
} from "@/lib/install-app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One build at a time — electron-builder is heavy and writes shared output.
let building = false;

/** Spawn a command, streaming its combined stdout/stderr into the response. */
function runStreamed(
  cmd: string,
  args: string[],
  cwd: string,
  emit: (text: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    emit(`\n$ ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, { cwd, env: augmentedPathEnv() });
    child.stdout.on("data", (c: Buffer) => emit(c.toString()));
    child.stderr.on("data", (c: Buffer) => emit(c.toString()));
    child.on("error", (err) => {
      emit(`\n[error] ${err.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (building) {
    return NextResponse.json({ error: "A build is already in progress." }, { status: 409 });
  }
  building = true;

  const cwd = repoRoot();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        if (!wrapperDepsInstalled()) {
          emit("Installing launcher dependencies…\n");
          const code = await runStreamed(
            "npm",
            ["install", "--prefix", "electron-wrapper"],
            cwd,
            emit,
          );
          if (code !== 0) {
            emit(`\n[devhub:error] dependency install failed (exit ${code})\n`);
            return;
          }
        }

        emit("Building the DevHub desktop app… (this can take a few minutes)\n");
        const code = await runStreamed(
          "npm",
          ["run", "dist", "--prefix", "electron-wrapper"],
          cwd,
          emit,
        );
        if (code !== 0) {
          emit(`\n[devhub:error] build failed (exit ${code})\n`);
          return;
        }

        const artifact = resolveBuiltArtifact(releaseDir(), process.platform);
        if (!artifact) {
          emit(`\n[devhub:error] build finished but no installable artifact was found in ${releaseDir()}\n`);
          return;
        }

        emit(`\nInstalling ${path.basename(artifact.src)}…\n`);
        const dest = placeArtifact(artifact);
        emit(`\n[devhub:installed] ${dest}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit(`\n[devhub:error] ${message}\n`);
      } finally {
        building = false;
        controller.close();
      }
    },
    cancel() {
      building = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
