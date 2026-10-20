import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createTask } from "../../shared/tasks/store";
import { mutateOrchestration, newOrchestration, readOrchestration } from "../lib/storyboard/orchestration-store";
import type { QaRunRecord } from "../lib/qa/store";

/** End-to-end check against a running dashboard using an isolated vault and task root. */
async function main() {
  const notesDir = process.env.QA_NOTES_DIR;
  if (!notesDir) throw new Error("Set QA_NOTES_DIR to the same isolated vault used by the test server.");
  const origin = process.env.QA_DASHBOARD_URL ?? "http://127.0.0.1:1362";
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Smoke checks require a local dashboard.");
  const headers = { "Content-Type": "application/json", Origin: origin };
  const post = async (body: unknown) => {
    const response = await fetch(origin + "/api/qa", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error("QA API returned " + response.status);
    return await response.json() as { run?: QaRunRecord };
  };
  const fixture = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(req.url === "/fail"
      ? '<!doctype html><title>Failure fixture</title><h1>Expected failure</h1><p hidden>Verified destination</p><button>Wait</button>'
      : '<!doctype html><title>Pass fixture</title><h1>QA fixture</h1><button onclick="document.querySelector(\'h1\').textContent=\'Verified destination\'">Open destination</button>');
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed.");
  const tasksDir = path.join(notesDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  const task = createTask(tasksDir, { text: "Verify QA failure and recovery", startDate: new Date().toISOString().slice(0, 10) });
  await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: task.startDate }), notesDir);
  const results: { run: string; status: string; storyboard: string; artifacts: number }[] = [];
  try {
    for (const failing of process.env.QA_LEAVE_FAILURE === "1" ? [true, false, true] : [true, false]) {
      const scenarioId = "api-smoke";
      await post({ action: "scenario", scenario: {
        id: scenarioId, title: "QA API smoke", surface: "dom", url: "http://127.0.0.1:" + address.port + (failing ? "/fail" : "/"),
        goals: [{ id: "outcome", description: "Click Open destination and verify that it appears", assertion: "text", selector: failing ? "p" : "h1", expected: "Verified destination" }],
        maxSteps: failing ? 1 : 5, maxDurationMs: 60000,
      } });
      const requestId = randomUUID();
      const body = { action: "run", scenarioId, requestId, taskId: task.id };
      const started = await post(body);
      if (!started.run) throw new Error("No run reserved.");
      const replay = await post(body);
      if (replay.run?.id !== started.run.id) throw new Error("Request replay created another run.");
      const deadline = Date.now() + 90000;
      let run = started.run;
      while (run.state === "running" && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const response = await fetch(origin + "/api/qa", { headers, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error("Run polling failed: " + response.status);
        const data = await response.json() as { runs: QaRunRecord[] };
        run = data.runs.find(row => row.id === run.id) ?? run;
      }
      if (!run.receipt || run.state !== "finished") throw new Error("Run did not finish.");
      if ((run.receipt.status === "passed") === failing) throw new Error("Deterministic result was wrong.");
      const orchestration = readOrchestration(task.id, notesDir);
      if (orchestration?.status !== (failing ? "needs-you" : "paused")) throw new Error("Storyboard status was wrong.");
      const video = run.receipt.artifacts.find(artifact => artifact.kind === "video");
      if (!video) throw new Error("Video missing.");
      const range = await fetch(origin + "/api/qa/runs/" + run.id + "/media/" + video.file, { headers: { ...headers, Range: "bytes=0-15" }, signal: AbortSignal.timeout(60000) });
      if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 16) throw new Error("Video range request failed.");
      results.push({ run: run.id, status: run.receipt.status, storyboard: orchestration.status, artifacts: run.receipt.artifacts.length });
      console.log(JSON.stringify(results.at(-1)));
    }
    await writeFile(path.join(notesDir, "qa-api-smoke.json"), JSON.stringify({ taskId: task.id, results }, null, 2) + "\n");
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "QA API smoke failed."); process.exitCode = 1; });
