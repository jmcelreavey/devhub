import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { runQa, jevPolicy } from "@devhub/qa";
import { BrowserDriver } from "@devhub/qa/browser";
import { typesafeApiKey } from "../lib/qa/credentials";
import { DesktopDriver } from "../lib/qa/desktop";
import { readSettings, runDir, saveScenario, writeRun } from "../lib/qa/store";
import { visionPolicy } from "../lib/qa/vision";
import { ScenarioSchema } from "../lib/qa/schema";

class SmokeBrowserDriver extends BrowserDriver {
  override async start(signal: AbortSignal): Promise<void> {
    await super.start(signal);
    const [hidden] = await this.assert([{ id: "hidden", description: "Hidden text must never pass", assertion: "text", selector: "h2", expected: "Already verified" }], signal);
    if (hidden.passed) throw new Error("Hidden text incorrectly satisfied a visible-text assertion.");
  }
}

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  const notesDir = process.env.QA_NOTES_DIR;
  if (!notesDir) throw new Error("Set QA_NOTES_DIR to an isolated test vault.");
  const server = createServer((_req, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><html lang="en"><head><title>QA fixture</title></head><body><h2 hidden>Already verified</h2><h1>QA navigation fixture</h1><button onclick="document.querySelector(\'h1\').textContent=\'Verified destination\';this.remove()">Open destination</button></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server failed.");
  try {
    const scenarios = [ScenarioSchema.parse({
      id: "dom-smoke", title: "DOM smoke: open destination", surface: "dom", url: `http://127.0.0.1:${address.port}`,
      goals: [{ id: "destination", description: "Click Open destination to show Verified destination", assertion: "text", selector: "h1", expected: "Verified destination" }, { id: "errors", description: "No page errors", assertion: "no-errors" }],
    })];
    if (process.env.QA_DESKTOP_BUNDLE) scenarios.push(ScenarioSchema.parse({
      id: "desktop-smoke", title: "DevHub native window", surface: "desktop", bundleId: process.env.QA_DESKTOP_BUNDLE,
      goals: [{ id: "window", description: "DevHub window exposes its title through accessibility", assertion: "text", expected: "DevHub" }],
      maxDurationMs: 90000,
    }));
    for (const scenario of scenarios) {
      saveScenario(scenario, notesDir);
      const id = randomUUID();
      const outputDir = runDir(id, notesDir);
      const driver = scenario.surface === "desktop" ? new DesktopDriver(scenario.bundleId!, outputDir) : new SmokeBrowserDriver({ url: scenario.url!, outputDir });
      const receipt = await runQa(scenario, driver, {
        text: jevPolicy({ apiKey: typesafeApiKey }), fallback: visionPolicy(readSettings()), experimentalImages: false, minConfidence: 0.65,
      }, { id });
      writeRun({ id, requestId: id, scenarioId: scenario.id, createdAt: receipt.startedAt, state: "finished", receipt }, notesDir);
      await mkdir(path.join(notesDir, "qa-verification"), { recursive: true });
      await writeFile(path.join(notesDir, "qa-verification", scenario.id + ".json"), JSON.stringify({ status: receipt.status, reason: receipt.stopReason, steps: receipt.steps.length, artifacts: receipt.artifacts.length }, null, 2));
      console.log(JSON.stringify({ scenario: scenario.id, id, status: receipt.status, reason: receipt.stopReason, steps: receipt.steps.length, artifacts: receipt.artifacts.length }));
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "QA smoke failed."); process.exitCode = 1; });
