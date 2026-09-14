#!/usr/bin/env tsx
/**
 * DevHub agent runner — executes ONE dispatched agent run inside a terminal tab.
 *
 *   agent-run <run-dir>
 *
 * `/api/agent/runs` writes the run's spec.json and asks the terminal dock to
 * open a tab running this script. Living in the tab is the point: the user
 * watches the agent work, and Ctrl+C or closing the tab stops it. The runner:
 *
 * - spawns the provider CLI with its argv directly (no shell, so the prompt is
 *   never re-parsed),
 * - parses each stdout line into normalised events (lib/agent-runs/events.ts),
 * - prints a readable version into the tab and appends each event to
 *   events.jsonl for MCP callers,
 * - keeps status.json current and records the outcome.
 *
 * Bundled to services/agent-run.cjs for the desktop app (stage-dashboard.mjs).
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import {
  clip,
  parseStreamLine,
  renderAgentEvent,
  stripAnsi,
  type AgentRunEvent,
} from "../lib/agent-runs/events";
import {
  appendRunEvent,
  readRunSpec,
  readRunStatus,
  writeRunStatus,
  type AgentRunState,
  type AgentRunStatus,
} from "../lib/agent-runs/run-files";

const STATUS_FLUSH_MS = 1_000;
const KILL_GRACE_MS = 5_000;
const RESULT_TEXT_MAX = 8_000;

const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function exitWith(message: string): never {
  process.stderr.write(`${red(message)}\n`);
  process.exit(2);
}

/** Chunks in, whole lines out — a multi-byte character may straddle two chunks. */
function lineReader(onLine: (line: string) => void): { push: (chunk: Buffer) => void; end: () => void } {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const drain = () => {
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      onLine(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  };
  return {
    push: (chunk) => {
      buffer += decoder.write(chunk);
      drain();
    },
    end: () => {
      buffer += decoder.end();
      drain();
      if (buffer) onLine(buffer);
      buffer = "";
    },
  };
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) exitWith("usage: agent-run <run-dir>");
  const spec = readRunSpec(dir);
  const initial = readRunStatus(dir);
  if (!spec || !initial) exitWith(`No agent run at ${dir}`);
  // Re-running from shell history must never replay an agent with approvals off.
  if (initial.state !== "queued") exitWith(`Run ${spec.id} is already ${initial.state} — dispatch a new run instead.`);

  // A closed tab turns stdout into EPIPE; the exit path must still write status.
  process.stdout.on("error", () => {});

  let status: AgentRunStatus = initial;
  let dirty = false;
  let seq = initial.eventCount;
  let cancelled = false;
  let finished = false;
  let resultOk: boolean | null = null;
  let transcript = "";

  const update = (patch: Partial<AgentRunStatus>) => {
    status = { ...status, ...patch };
    dirty = true;
  };
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    status = writeRunStatus(dir, status);
  };

  const emit = (event: AgentRunEvent, display = renderAgentEvent(event)) => {
    appendRunEvent(dir, { ...event, seq, ts: Date.now() });
    seq += 1;
    process.stdout.write(`${display}\n`);
    const patch: Partial<AgentRunStatus> = { eventCount: seq };
    if (event.type === "session") patch.sessionId = event.sessionId;
    if (event.type === "text") transcript = `${transcript}\n${event.text}`.slice(-RESULT_TEXT_MAX);
    if (event.type === "error") patch.error = event.message;
    if (event.type === "result") {
      resultOk = event.ok;
      patch.resultText = event.text === undefined ? undefined : clip(event.text, RESULT_TEXT_MAX);
      patch.costUsd = event.costUsd;
      patch.turns = event.turns;
    }
    update(patch);
  };

  process.stdout.write(
    [
      dim(`── DevHub agent run ${spec.id} · ${spec.providerLabel}${spec.model ? ` (${spec.model})` : ""} ──`),
      dim(`cwd ${spec.cwd}${spec.worktree ? ` (worktree ${spec.worktree.branch})` : ""}`),
      dim(clip(spec.prompt.replace(/\s+/g, " "), 300)),
      "",
      "",
    ].join("\n"),
  );

  const child = spawn(spec.bin, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      // The CLI's own MCP servers inherit these, so a nested dispatch can be refused.
      DEVHUB_AGENT_DEPTH: String(spec.depth + 1),
      DEVHUB_AGENT_RUN_ID: spec.id,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  update({
    state: "running",
    pid: process.pid,
    startedAt: Date.now(),
    terminalSessionId: process.env.DEVHUB_TERMINAL_SESSION_ID,
  });
  flush();
  const flushTimer = setInterval(flush, STATUS_FLUSH_MS);

  const stdout = lineReader((line) => {
    const events = parseStreamLine(spec.format, line);
    if (spec.format === "text") {
      // Plain-text CLIs keep their own formatting in the tab.
      if (events[0]) emit(events[0], line);
      else process.stdout.write("\n");
      return;
    }
    for (const event of events) emit(event);
  });
  const stderr = lineReader((line) => {
    const text = stripAnsi(line).trim();
    if (text) emit({ type: "stderr", text: clip(text, 2_000) }, dim(line));
  });
  child.stdout.on("data", stdout.push);
  child.stderr.on("data", stderr.push);

  const finish = (exitCode: number | null) => {
    if (finished) return;
    finished = true;
    clearInterval(flushTimer);
    stdout.end();
    stderr.end();
    const state: AgentRunState = cancelled
      ? "cancelled"
      : exitCode === 0 && resultOk !== false
        ? "succeeded"
        : "failed";
    update({
      state,
      exitCode,
      finishedAt: Date.now(),
      resultText: status.resultText ?? (transcript.trim() || undefined),
      error:
        state === "failed"
          ? (status.error ?? `${spec.providerLabel} exited with code ${exitCode ?? "unknown"}`)
          : status.error,
    });
    flush();
    process.stdout.write(`\n${(state === "succeeded" ? green : red)(`── ${state} ──`)}\n`);
    process.exitCode = state === "succeeded" ? 0 : 1;
  };

  child.on("error", (err) => {
    emit({ type: "error", message: `Could not start ${spec.bin}: ${err.message}` });
    finish(null);
  });
  child.on("close", (code) => finish(code));

  const stop = (signal: NodeJS.Signals) => {
    if (cancelled || finished) return;
    cancelled = true;
    process.stdout.write(`\n${dim(`── ${signal}: stopping ${spec.providerLabel} ──`)}\n`);
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(signal));
}

main();
