#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { gitMutationEnv, withRepoGitMutation } from "../apps/core/src/lib/git/mutation-queue.ts";

const root = process.env.GIT_DIR ? path.resolve(process.env.GIT_DIR) : process.cwd();

try {
  process.exitCode = await withRepoGitMutation(root, () => new Promise((resolve, reject) => {
    const child = spawn("git", process.argv.slice(2), { stdio: "inherit", env: gitMutationEnv(process.env) });
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      resolve(code ?? (128 + (os.constants.signals[signal] ?? 1)));
    });
  }));
} catch (error) {
  process.stderr.write(`Git lock failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
