/**
 * Server-side oneshot text generation via local agent CLIs.
 * Used when DEVHUB_AI_PROVIDER is a CLI (not the HTTP API path).
 *
 * Print/oneshot only — never pass --force / --approve-mcps / --yolo. Headless
 * briefings and learn-repo ingest untrusted text (Jira, calendar, repo);
 * auto-approving tools would turn prompt injection into real side effects.
 * `--trust` only skips the workspace-trust TTY prompt; it is not tool YOLO.
 * Interactive terminal launches keep their own confirm UX separately.
 */

import { spawn } from "node:child_process";
import { cliLimiter } from "./cli-limit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCursorAgentBin, readAgentCliSettings } from "@/lib/agent/cli-env";
import { getNotesDir } from "@/lib/content/dirs";
import { getCheckoutRoot, getResourceRoot } from "@/lib/desktop/runtime-paths";
import { augmentedPathEnv } from "@/lib/process-env";
import {
  resolveChatgptCliBin,
  resolveOpencodeCliBin,
  type AiProviderId,
} from "@/lib/ai/preference";


const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Flags that auto-approve tools or skip every safety prompt. Never on print/oneshot. */
export const CURSOR_HEADLESS_FORBIDDEN_FLAGS = ["--yolo", "--force", "--approve-mcps", "-f"] as const;

export interface CliGenerateResult {
  text: string;
  provider: Exclude<AiProviderId, "api">;
}

export interface HeadlessCwdInput {
  checkoutRoot?: string | null;
  notesDir?: string | null;
  home?: string;
  resourceRoot?: string | null;
  requestedCwd?: string | null;
}

function runEnv(): NodeJS.ProcessEnv {
  return augmentedPathEnv({
    REPO_ROOT: process.env.REPO_ROOT,
    NOTES_DIR: process.env.NOTES_DIR,
  });
}

/** Packaged DevHub.app resource tree — never a generation cwd. */
export function isPackagedAppResourcePath(dir: string): boolean {
  const n = dir.replaceAll("\\", "/");
  return n.includes(".app/Contents/Resources") || n.includes(".app/Contents/MacOS");
}

function isUsableCwd(dir: string | null | undefined, resourceRoot?: string | null): dir is string {
  if (!dir || !dir.trim()) return false;
  const resolved = path.resolve(dir);
  if (isPackagedAppResourcePath(resolved)) return false;
  if (resourceRoot?.trim()) {
    const res = path.resolve(resourceRoot);
    if (resolved === res || resolved.startsWith(res + path.sep)) return false;
  }
  try {
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pick a cwd for non-interactive CLI generation.
 * Checkout → notes dir → $HOME. Never the app-bundle resource root.
 */
export function resolveHeadlessCliCwd(input: HeadlessCwdInput = {}): string {
  const home = input.home?.trim() ? path.resolve(input.home) : os.homedir();
  const resourceRoot = input.resourceRoot;
  for (const candidate of [input.requestedCwd, input.checkoutRoot, input.notesDir, home]) {
    if (isUsableCwd(candidate, resourceRoot)) return path.resolve(candidate);
  }
  return home;
}

/** Live lookup used by generateTextViaCli. */
export function headlessCliCwd(requestedCwd?: string | null): string {
  return resolveHeadlessCliCwd({
    requestedCwd,
    checkoutRoot: getCheckoutRoot(),
    notesDir: getNotesDir(),
    home: os.homedir(),
    resourceRoot: getResourceRoot(),
  });
}

/**
 * cursor-agent print/oneshot argv.
 * `--trust` skips the workspace-trust prompt for the process cwd.
 * Do not add --yolo / --force / --approve-mcps here.
 *
 * Plain `--print` buffers: it emits nothing at all until the whole reply is
 * ready (measured at >140s of silence on a canvas-sized prompt), so there was
 * no way to tell a working run from a hung one and long generations were
 * killed on wall-clock alone. stream-json emits a line per delta instead.
 */
export function cursorAgentPrintArgs(prompt: string, model: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ];
}

/**
 * Pull the finished reply out of a cursor-agent stream-json transcript.
 *
 * The terminal `result` event holds the complete text; the `assistant` deltas
 * are for liveness only and repeat the full message at the end, so joining
 * them would duplicate it. Deltas are the fallback when a run was cut short
 * before the result event landed.
 */
export function extractCursorStreamText(raw: string): string {
  const deltas: string[] = [];
  let result: string | null = null;
  let sawJson = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // a torn final line when the process was killed mid-write
    }
    sawJson = true;
    if (event.type === "result" && typeof event.result === "string") {
      result = event.result;
      continue;
    }
    if (event.type !== "assistant") continue;
    const message = event.message as { content?: { type?: string; text?: string }[] } | undefined;
    for (const block of message?.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") deltas.push(block.text);
    }
  }

  if (result != null) return result.trim();
  // Not JSON at all — a plain-text CLI, or an error written to stderr.
  if (!sawJson) return raw.trim();
  return deltas.join("").trim();
}

/**
 * Longest a CLI may go without writing a byte before we give up on it.
 *
 * The previous total wall-clock timeout was the wrong measure: generating a
 * complete briefing canvas is legitimately a multi-minute job, so a run that
 * was streaming steadily still got killed at the ceiling — and because
 * execFile discards the child's buffers when it kills it, a document that was
 * nearly finished was thrown away with it. Idle time is what actually
 * distinguishes a hung CLI from a slow one.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export interface CaptureOutcome {
  text: string;
  /** True when the run was cut short but produced usable output anyway. */
  timedOut: boolean;
  elapsedMs: number;
}

/** Does this look like a finished HTML document rather than a truncated one? */
export function looksComplete(text: string): boolean {
  return /<\/html\s*>/i.test(text) || /<\/body\s*>/i.test(text);
}

export type TimeoutReason = "idle" | "ceiling";

/**
 * Say which limit was hit, because the remedies are opposite.
 *
 * These used to share one message, so a run that was still streaming when it
 * hit its ceiling was reported as having "stopped responding" — which sends
 * you off simplifying a prompt that was working fine, when the real answer is
 * that it needed longer (or that too many were running at once).
 */
export function describeCliTimeout(
  bin: string,
  elapsedMs: number,
  bytes: number,
  reason: TimeoutReason = "idle",
): string {
  const secs = Math.round(elapsedMs / 1000);
  if (reason === "ceiling") {
    return `${bin} hit its ${secs}s time limit while still working (${bytes} bytes so far). Give this task longer, or run fewer generations at once — parallel runs slow each other down.`;
  }
  if (bytes === 0) {
    return `${bin} produced no output in ${secs}s — it may be waiting on a prompt (check the model and that the CLI is signed in).`;
  }
  return `${bin} went quiet for the last stretch of ${secs}s, with ${bytes} bytes of a partial reply. Try a simpler instruction, or a faster model under Setup → AI Provider.`;
}

/**
 * Run a CLI and collect stdout, giving up only once it goes quiet.
 *
 * spawn rather than execFile so output can be watched as it arrives: the idle
 * timer resets on every chunk, and whatever was produced survives a kill.
 */
/** Exported for tests — prefer generateTextViaCli. */
export async function execCapture(
  bin: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
  signal?: AbortSignal,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  /** Decode the wire format (e.g. stream-json) before it is judged or returned. */
  transform?: (raw: string) => string,
): Promise<string> {
  // The limiter wraps only the spawn, so a job's clock starts when its process
  // does — time spent queueing behind other runs is not held against it.
  return cliLimiter.run(
    () => captureOnce(bin, args, timeoutMs, cwd, signal, idleTimeoutMs, transform),
    signal,
  );
}

async function captureOnce(
  bin: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
  signal: AbortSignal | undefined,
  idleTimeoutMs: number,
  transform: ((raw: string) => string) | undefined,
): Promise<string> {
  const startedAt = Date.now();
  const outcome = await new Promise<
    CaptureOutcome & { code: number | null; err?: Error; timeoutReason: TimeoutReason }
  >(
    (resolve) => {
      // detached gives the CLI its own process group so the whole tree can be
      // signalled. Killing just the direct child leaves grandchildren holding
      // the stdout pipe open, and "close" then never fires.
      const child = spawn(bin, args, { env: runEnv(), cwd, detached: true });
      let out = "";
      let errText = "";
      let bytes = 0;
      let settled = false;
      let sawOutput = false;
      let idleTimer: NodeJS.Timeout | undefined;
      let timedOut = false;
      let timeoutReason: TimeoutReason = "idle";

      const finish = (code: number | null, err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          text: (out.trim() || errText.trim()),
          timedOut,
          timeoutReason,
          elapsedMs: Date.now() - startedAt,
          code,
          err,
        });
      };

      const killGroup = (sig: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, sig);
        } catch {
          /* already gone */
        }
      };

      const kill = (reason: TimeoutReason) => () => {
        timedOut = true;
        timeoutReason = reason;
        killGroup("SIGTERM");
        // SIGKILL if it ignores the polite request.
        setTimeout(() => killGroup("SIGKILL"), 2_000).unref?.();
        // Settle on what we already have rather than waiting for the pipes: a
        // lingering grandchild can hold them open indefinitely.
        finish(null);
      };

      // Started before the abort check below so it is always initialised by the
      // time finish()/onAbort() clear it.
      const hardTimer = setTimeout(kill("ceiling"), Math.max(timeoutMs, idleTimeoutMs));

      // Until the first byte the CLI may just be thinking, and some CLIs stay
      // silent for minutes. That phase is the hard ceiling's job; the idle
      // timer only starts once output has actually begun.
      const touch = () => {
        if (!sawOutput) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(kill("idle"), idleTimeoutMs);
      };

      function onAbort() {
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
        resolve({
          text: "",
          timedOut: false,
          timeoutReason,
          elapsedMs: Date.now() - startedAt,
          code: null,
          err: new Error("Generation cancelled."),
        });
      }

      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        sawOutput = true;
        bytes += chunk.length;
        // Keep the tail if a CLI floods us; the document end is what matters.
        if (bytes <= MAX_BUFFER) out += chunk.toString("utf8");
        touch();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        sawOutput = true;
        if (errText.length <= MAX_BUFFER) errText += chunk.toString("utf8");
        touch();
      });
      child.on("error", (e) => finish(null, e as Error));
      child.on("close", (code) => finish(code));

    },
  );

  if (outcome.err) {
    const e = outcome.err as NodeJS.ErrnoException;
    if (e.message === "Generation cancelled.") throw e;
    if (e.code === "ENOENT") throw new Error(`${bin} not found on PATH.`);
    throw new Error(`${bin} failed: ${e.message}`);
  }

  const decoded = transform ? transform(outcome.text) : outcome.text;

  if (outcome.timedOut) {
    // A finished document that merely ran long is still a good answer — only
    // treat the timeout as fatal when what came back is unusable.
    if (decoded && looksComplete(decoded)) return decoded;
    throw new Error(
      describeCliTimeout(bin, outcome.elapsedMs, decoded.length, outcome.timeoutReason),
    );
  }

  if (!decoded) throw new Error(`${bin} returned empty output.`);
  if (outcome.code !== 0 && !looksComplete(decoded)) {
    throw new Error(`${bin} failed (exit ${String(outcome.code ?? "?")}): ${decoded.slice(0, 400)}`);
  }
  return decoded;
}

/** Approximate CLI token budget — CLIs lack maxOutputTokens; clip input + instruct. */
export function applyCliTokenBudget(prompt: string, maxOutputTokens?: number): string {
  if (maxOutputTokens == null || maxOutputTokens <= 0) return prompt;
  const instruction = `\n\n[Keep the response under ~${maxOutputTokens} tokens.]`;
  // Rough 4 chars/token; leave headroom for instruction + output.
  const maxInputChars = Math.max(4_000, (48_000 - maxOutputTokens) * 4);
  const body =
    prompt.length > maxInputChars
      ? `${prompt.slice(0, maxInputChars)}\n\n[…prompt truncated for CLI token budget…]`
      : prompt;
  return body + instruction;
}

/**
 * Run a prompt through a local CLI in print/oneshot mode and return stdout.
 */
export async function generateTextViaCli(
  provider: Exclude<AiProviderId, "api">,
  prompt: string,
  opts?: {
    timeoutMs?: number;
    /** Give up only after this long with no output. Defaults to 90s. */
    idleTimeoutMs?: number;
    maxOutputTokens?: number;
    cwd?: string | null;
    abortSignal?: AbortSignal;
  },
): Promise<CliGenerateResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleTimeoutMs = opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const settings = readAgentCliSettings();
  prompt = applyCliTokenBudget(prompt, opts?.maxOutputTokens);
  const cwd = headlessCliCwd(opts?.cwd);

  if (provider === "cursor-cli") {
    const bin = resolveCursorAgentBin() ?? "cursor-agent";
    const text = await execCapture(
      bin,
      cursorAgentPrintArgs(prompt, settings.cursorModel),
      timeoutMs,
      cwd,
      opts?.abortSignal,
      idleTimeoutMs,
      extractCursorStreamText,
    );
    return { text, provider };
  }

  if (provider === "opencode") {
    const bin = resolveOpencodeCliBin();
    const args = ["run"];
    if (settings.opencodeModel.trim()) {
      args.push("--model", settings.opencodeModel.trim());
    }
    args.push(prompt);
    const text = await execCapture(bin, args, timeoutMs, cwd, opts?.abortSignal, idleTimeoutMs);
    return { text, provider };
  }

  // chatgpt-cli — Codex non-interactive exec
  const bin = resolveChatgptCliBin();
  if (!bin) {
    throw new Error("ChatGPT / Codex CLI not found.");
  }
  const text = await execCapture(bin, ["exec", prompt], timeoutMs, cwd, opts?.abortSignal, idleTimeoutMs);
  return { text, provider };
}
