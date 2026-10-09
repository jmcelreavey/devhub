/**
 * What every plugin operation needs to know about where it runs: the home it
 * writes under, the environment it spawns tools with, and the runner that
 * actually starts them (replaced in tests).
 */
import os from "node:os";
import path from "node:path";
import { augmentedPathEnv } from "@/lib/process-env";
import { resolvePluginPaths, type PluginPaths } from "./paths";
import { realCommandRunner, type CommandRunner } from "./source";

export class PluginApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly operationId?: string;

  constructor(status: number, code: string, message: string, retryable = false, operationId?: string) {
    super(message);
    this.name = "PluginApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.operationId = operationId;
  }
}

export interface PluginContext {
  home: string;
  env: NodeJS.ProcessEnv;
  paths: PluginPaths;
  /** Where core skills and agents live, so a plugin that repeats one can be told so. */
  repoRoot: string | null;
  runner: CommandRunner;
}

export function pluginContext(opts: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  repoRoot?: string | null;
  runner?: CommandRunner;
} = {}): PluginContext {
  const home = opts.home ?? os.homedir();
  return {
    home,
    env: opts.env ?? (path.resolve(home) === path.resolve(os.homedir()) ? process.env : { NODE_ENV: process.env.NODE_ENV }),
    paths: resolvePluginPaths(opts.env ? { home, env: opts.env } : { home }),
    repoRoot: opts.repoRoot ?? null,
    runner: opts.runner ?? realCommandRunner(),
  };
}

/**
 * Environment for the tools a plugin operation starts. The real process gets
 * the same PATH additions every other DevHub tool call gets, so `gh` resolves
 * when the dashboard was launched from a minimal environment. An injected
 * environment is used as given.
 */
export function toolEnv(ctx: PluginContext): NodeJS.ProcessEnv {
  return ctx.env === process.env ? augmentedPathEnv() : ctx.env;
}
