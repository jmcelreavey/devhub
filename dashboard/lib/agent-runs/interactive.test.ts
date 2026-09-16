import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendInteractiveAgentNote,
  cancelAgentRun,
  createInteractiveAgentRun,
  finishInteractiveAgentRun,
  readAgentRun,
} from "@/lib/agent-runs/store";
import { readRunEvents } from "@/lib/agent-runs/run-files";
import { spawn } from "node:child_process";
import {
  attachInteractiveShell,
  finishInteractiveFromExit,
  interactiveStateForExit,
} from "@/lib/agent-runs/interactive-shell";

describe("interactive agent runs", () => {
  let root: string;
  let prev: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-interactive-"));
    prev = process.env.DEVHUB_AGENT_RUNS_DIR;
    process.env.DEVHUB_AGENT_RUNS_DIR = root;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DEVHUB_AGENT_RUNS_DIR;
    else process.env.DEVHUB_AGENT_RUNS_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const newRun = (id: string) =>
    createInteractiveAgentRun({
      id,
      provider: "claude",
      providerLabel: "Claude Code",
      cwd: root,
      title: "Interactive test",
      prompt: "do the thing",
    });

  it("stays queued until the tab's shell attaches, then runs", () => {
    const run = newRun("run-termabc1-abcdef01");
    expect(run.status.state).toBe("queued");
    expect(run.spec.bin).toBe("interactive");
    expect(readAgentRun(run.spec.id)?.status.state).toBe("queued");

    attachInteractiveShell(run.dir, process.pid);
    const attached = readAgentRun(run.spec.id);
    expect(attached?.status.state).toBe("running");
    expect(attached?.status.pid).toBe(process.pid);
  });

  it("records the CLI exit, but never overrides an MCP finish", () => {
    const run = newRun("run-termabc4-abcdef04");
    attachInteractiveShell(run.dir, process.pid);
    const done = finishInteractiveFromExit(run.dir, 1);
    expect(done?.status.state).toBe("failed");
    expect(done?.status.pid).toBeUndefined();
    expect(finishInteractiveFromExit(run.dir, 0)).toBeNull();
    expect(attachInteractiveShell(run.dir, process.pid)).toBeNull();

    const viaMcp = newRun("run-termabc5-abcdef05");
    finishInteractiveAgentRun(viaMcp, { ok: true, resultText: "done" });
    expect(finishInteractiveFromExit(viaMcp.dir, 130)).toBeNull();
    expect(readAgentRun(viaMcp.spec.id)?.status.state).toBe("succeeded");
  });

  it("maps exit codes: 0 succeeded, Ctrl+C cancelled, else failed", () => {
    expect(interactiveStateForExit(0)).toBe("succeeded");
    expect(interactiveStateForExit(130)).toBe("cancelled");
    expect(interactiveStateForExit(2)).toBe("failed");
  });

  it("closes the run when the tab's shell is gone", async () => {
    const shell = spawn("true");
    await new Promise((resolve) => shell.on("exit", resolve));
    const run = newRun("run-termabc6-abcdef06");
    attachInteractiveShell(run.dir, shell.pid!);
    const reconciled = readAgentRun(run.spec.id);
    expect(reconciled?.status.state).toBe("cancelled");
    expect(reconciled?.status.error).toMatch(/tab closed/);
  });

  it("cancelling never signals the user's shell", () => {
    const shell = spawn("sleep", ["30"]);
    try {
      const run = newRun("run-termabc7-abcdef07");
      attachInteractiveShell(run.dir, shell.pid!);
      const { outcome } = cancelAgentRun(readAgentRun(run.spec.id)!);
      expect(outcome).toBe("cancelled");
      expect(shell.exitCode).toBeNull();
      expect(shell.signalCode).toBeNull();
    } finally {
      shell.kill();
    }
  });

  it("notes and finishes via MCP-facing helpers", () => {
    const run = createInteractiveAgentRun({
      id: "run-termabc2-abcdef02",
      provider: "claude",
      providerLabel: "Claude Code",
      cwd: root,
      title: "Interactive test",
      prompt: "do the thing",
    });
    const noted = appendInteractiveAgentNote(run, "Started looking at the failing test");
    expect(noted.status.eventCount).toBe(1);
    const page = readRunEvents(noted.dir, 0, 10);
    expect(page.events[0]).toMatchObject({ type: "text", text: "Started looking at the failing test" });

    const finished = finishInteractiveAgentRun(noted, {
      ok: true,
      resultText: "All green",
      sessionId: "sess-123",
    });
    expect(finished.status.state).toBe("succeeded");
    expect(finished.status.sessionId).toBe("sess-123");
    expect(finished.status.resultText).toBe("All green");
  });

  it("cancels an interactive run without a pid", () => {
    const run = createInteractiveAgentRun({
      id: "run-termabc3-abcdef03",
      provider: "claude",
      providerLabel: "Claude Code",
      cwd: root,
      title: "Interactive test",
      prompt: "do the thing",
    });
    const { run: cancelled, outcome } = cancelAgentRun(run);
    expect(outcome).toBe("cancelled");
    expect(cancelled.status.state).toBe("cancelled");
  });
});
