import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Artifact, GoalResult, Observation, QaAction, QaDriver, QaGoal } from "@devhub/qa";
import { execExternal } from "@/lib/exec-external";
import { ACCESSIBILITY_SOURCE } from "./accessibility-source";

const SnapshotSchema = z.object({ text: z.string(), windowId: z.number().int().positive(), controls: z.array(z.object({ id: z.string(), name: z.string() })) });
const hash = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

export class DesktopDriver implements QaDriver {
  readonly surface = "desktop" as const;
  private helper = "";
  private windowId = 0;
  private frames: { file: string; at: number }[] = [];
  private targets = new Map<string, string>();
  constructor(private readonly bundleId: string, private readonly outputDir: string) {}
  private async snapshot(signal: AbortSignal) {
    const result = await execExternal(this.helper, [this.bundleId, "snapshot"], { timeoutMs: 10000, signal, label: "qa:desktop-observe" });
    return SnapshotSchema.parse(JSON.parse(result.stdout));
  }
  async start(signal: AbortSignal): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Desktop QA requires macOS.");
    await fs.mkdir(this.outputDir, { recursive: true, mode: 0o700 });
    const helperDir = path.join(this.outputDir, "..", "..", "native");
    await fs.mkdir(helperDir, { recursive: true, mode: 0o700 });
    this.helper = path.join(helperDir, "ax-" + hash(ACCESSIBILITY_SOURCE).slice(0, 16));
    try { await fs.access(this.helper); }
    catch {
      const source = this.helper + ".swift";
      await fs.writeFile(source, ACCESSIBILITY_SOURCE, { mode: 0o600 });
      await execExternal("swiftc", [source, "-o", this.helper], { timeoutMs: 60000, signal, label: "qa:desktop-compile" });
    }
    const snapshot = await this.snapshot(signal);
    this.windowId = snapshot.windowId;
  }
  async observe(signal: AbortSignal): Promise<Observation> {
    const snapshot = await this.snapshot(signal);
    this.windowId = snapshot.windowId;
    this.targets = new Map(snapshot.controls.map(control => [control.id, control.name]));
    const frame = await this.capture("after");
    const screenshot = await fs.readFile(path.join(this.outputDir, frame.file));
    return {
      text: snapshot.text.slice(0, 16000), fingerprint: hash(snapshot.text), screenshot,
      actions: snapshot.controls.map(control => ({ id: "press-" + control.id, kind: "press", selector: control.id, description: "Press " + control.name })),
    };
  }
  async act(action: QaAction, signal: AbortSignal): Promise<void> {
    if (action.kind !== "press" || !action.selector) throw new Error("Desktop QA only presses observed accessibility controls.");
    const name = this.targets.get(action.selector);
    if (!name) throw new Error("Desktop control was not offered.");
    await execExternal(this.helper, [this.bundleId, "press", action.selector, name], { timeoutMs: 10000, signal, label: "qa:desktop-press" });
  }
  async assert(goals: QaGoal[], signal: AbortSignal): Promise<GoalResult[]> {
    const snapshot = await this.snapshot(signal);
    return goals.map(goal => ({
      id: goal.id, description: goal.description,
      passed: goal.assertion === "text" && Boolean(goal.expected) && snapshot.text.includes(goal.expected!),
      actual: goal.assertion === "text" ? snapshot.text.slice(0, 1000) : "This assertion is unsupported by the desktop runner.",
    }));
  }
  async capture(phase: Artifact["phase"]): Promise<Artifact> {
    if (!this.windowId) throw new Error("No desktop window to capture.");
    const file = `frame-${String(this.frames.length).padStart(4, "0")}.png`;
    await execExternal("screencapture", ["-x", "-l", String(this.windowId), path.join(this.outputDir, file)], { timeoutMs: 5000, label: "qa:desktop-capture" });
    const data = await fs.readFile(path.join(this.outputDir, file));
    this.frames.push({ file, at: Date.now() });
    return { file, kind: "image", phase, sha256: hash(data) };
  }
  async close(): Promise<Artifact[]> {
    if (!this.frames.length) return [];
    const lines = this.frames.flatMap((frame, index) => [
      `file '${frame.file}'`,
      `duration ${Math.max(0.1, ((this.frames[index + 1]?.at ?? frame.at + 1000) - frame.at) / 1000)}`,
    ]);
    lines.push(`file '${this.frames.at(-1)!.file}'`);
    await fs.writeFile(path.join(this.outputDir, "frames.ffconcat"), "ffconcat version 1.0\n" + lines.join("\n"));
    // Window-only time-lapse: avoids capturing other applications or taking focus.
    await execExternal("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-safe", "1", "-f", "concat", "-i", "frames.ffconcat", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "run.mp4"], { cwd: this.outputDir, timeoutMs: 30000, label: "qa:desktop-video" });
    return [{ file: "run.mp4", kind: "video", phase: "after", sha256: hash(await fs.readFile(path.join(this.outputDir, "run.mp4"))) }];
  }
}
