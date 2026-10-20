"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ModelSelect } from "@/components/agents/ProviderModelSelects";
import { EffortSelect } from "@/components/agents/EffortSelect";
import { useLive } from "@/lib/hooks/use-fetch";
import type { QaSettings, SavedScenario } from "@/lib/qa/schema";
import type { QaRunRecord } from "@/lib/qa/store";
import type { QaAction } from "@devhub/qa";
import { JEV_SETUP_HREF } from "@/lib/qa/typesafe-key";
import styles from "./qa.module.css";
import { RunReceipt } from "./RunReceipt";

interface Payload {
  scenarios: SavedScenario[];
  runs: QaRunRecord[];
  settings: QaSettings;
  models: string[];
  defaultModel: string;
  configured: { jev: boolean; vision: boolean; desktop: boolean };
}
const canvasActions: QaAction[] = [
  { id: "right", description: "Move right briefly", kind: "keys", keys: ["ArrowRight"], holdMs: 250 },
  { id: "left", description: "Move left briefly", kind: "keys", keys: ["ArrowLeft"], holdMs: 250 },
  { id: "jump-right", description: "Jump right", kind: "keys", keys: ["ArrowRight", "Space"], holdMs: 600 },
  { id: "jump", description: "Jump", kind: "keys", keys: ["Space"], holdMs: 400 },
  { id: "enter", description: "Advance a visible dialogue", kind: "keys", keys: ["Enter"], holdMs: 50 },
];
async function post(body: unknown): Promise<{ run?: QaRunRecord }> {
  const response = await fetch("/api/qa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "QA request failed.");
  return data;
}

export default function QaClient() {
  const params = useSearchParams();
  const router = useRouter();
  const taskId = params.get("task") ?? undefined;
  const selectedId = params.get("run");
  const { data, error, mutate } = useLive<Payload>("/api/qa", { refreshInterval: 3000 });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [edits, setEdits] = useState<Partial<QaSettings>>({});
  const [surface, setSurface] = useState<SavedScenario["surface"]>("dom");
  const selectedRun = selectedId ? data?.runs.find(run => run.id === selectedId) : data?.runs[0];
  const chosenScenario = data?.scenarios.find(scenario => scenario.id === (scenarioId || selectedRun?.scenarioId)) ?? data?.scenarios[0];
  const settings = data ? { ...data.settings, ...edits } : undefined;
  const active = data?.runs.find(run => run.state === "running");
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setFailure("");
    try { await work(); await mutate(); } catch (error) { setFailure(error instanceof Error ? error.message : "QA request failed."); }
    finally { setBusy(false); }
  };
  const createScenario = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void perform(async () => {
      const title = String(fields.get("title") ?? "").trim();
      await post({ action: "scenario", scenario: {
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) + "-" + crypto.randomUUID().slice(0, 8),
        title, surface,
        ...(surface === "desktop" ? { bundleId: fields.get("target") } : { url: fields.get("target") }),
        goals: [{ id: "outcome", description: String(fields.get("goal")), assertion: "text", selector: String(fields.get("selector") || "body"), expected: fields.get("expected") }],
        ...(surface === "canvas" ? { actions: canvasActions } : {}),
        maxSteps: 30, maxDurationMs: 120000, maxCostUsd: 0.5, stallSteps: 12,
      } });
      form.reset();
    });
  };
  return <div className={styles.page}>
    <PageHeader title="QA lab" subtitle="Run a goal, inspect the evidence, then decide what ships." />
    <div className={styles.toolbar}>
      <Link className="btn btn-ghost" href={taskId ? "/storyboard?task=" + encodeURIComponent(taskId) : "/storyboard"}>Storyboard</Link>
      {taskId && <p>Verify step · task <code>{taskId}</code></p>}
    </div>
    {error && !data ? <FetchError message={error.message} onRetry={() => void mutate()} /> : !data ? <SkeletonRows count={5} height={48} /> : <>
      {(failure || error) && <p role="alert" className="tone-panel tone-panel--warning-banner">{failure || "Couldn’t refresh QA. Showing the last result."}</p>}
      {!data.configured.jev && <p className="tone-panel tone-panel--warning-banner">Jev isn’t set up yet. <Link className="font-medium underline underline-offset-2" href={JEV_SETUP_HREF}>Add your TypeSafe key in Setup</Link></p>}
      <section className={styles.section} aria-labelledby="run-heading">
        <h2 id="run-heading">Verify a scenario</h2>
        <div className={styles.controls}>
          <label>Scenario<select className="input" value={chosenScenario?.id || ""} onChange={event => setScenarioId(event.target.value)}>
            {!data.scenarios.length && <option value="">Create a scenario below</option>}
            {data.scenarios.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.title} · {scenario.surface}</option>)}
          </select></label>
          <button className="btn btn-primary" disabled={busy || Boolean(active) || !chosenScenario} onClick={() => void perform(async () => {
            if (!chosenScenario) return;
            const result = await post({ action: "run", scenarioId: chosenScenario.id, requestId: crypto.randomUUID(), ...(taskId ? { taskId } : {}) });
            if (result.run) router.replace(`/qa?run=${result.run.id}${taskId ? "&task=" + encodeURIComponent(taskId) : ""}`);
          })}>{busy ? "Starting…" : "Run verification"}</button>
          {active && <button className="btn btn-danger-ghost" onClick={() => void perform(async () => { await post({ action: "cancel", id: active.id }); })}>Cancel active run</button>}
        </div>
        {active && <p role="status">Running · {active.receipt?.steps.length ?? 0} actions recorded. Screenshots and video appear when it finishes.</p>}
      </section>
      <div className={styles.workspace}>
        <section className={styles.history} aria-labelledby="history-heading">
          <h2 id="history-heading">Runs</h2>
          {!data.runs.length ? <p>No runs yet. Create a scenario and run its first check.</p> : <ol>
            {data.runs.slice(0, 40).map(run => <li key={run.id}>
              <Link href={`/qa?run=${run.id}${taskId ? "&task=" + encodeURIComponent(taskId) : ""}`} onClick={() => setScenarioId(run.scenarioId)} aria-current={selectedRun?.id === run.id ? "true" : undefined}>
                <strong>{run.receipt?.title ?? run.scenarioId}</strong>
                <span>{run.state === "running" ? "Running" : run.receipt?.status} · {new Date(run.createdAt).toLocaleTimeString("en-GB")}</span>
              </Link>
            </li>)}
          </ol>}
        </section>
        <section className={styles.receipt} aria-label="QA receipt">
          {selectedRun?.receipt ? <RunReceipt run={selectedRun} /> : <EmptyState title={selectedId && !selectedRun ? "Run not found" : "Evidence appears here"} subtitle={selectedId && !selectedRun ? "Choose a recorded run or start a new verification." : "Each run records screenshots, video, assertions and model usage. A model’s confidence never marks a goal as passed."} />}
        </section>
      </div>
      <details className={styles.section}>
        <summary>Create a scenario</summary>
        <form onSubmit={createScenario} className={styles.form}>
          <label>Name<input className="input" name="title" required maxLength={200} placeholder="Navigation smoke test" /></label>
          <label>Runner<select className="input" value={surface} onChange={event => setSurface(event.target.value as SavedScenario["surface"])}>
            <option value="dom">Web DOM</option><option value="canvas">Canvas · keyboard</option><option value="desktop" disabled={!data.configured.desktop}>macOS desktop</option>
          </select></label>
          <label>{surface === "desktop" ? "Application bundle ID" : "App URL"}<input className="input" name="target" type={surface === "desktop" ? "text" : "url"} required placeholder={surface === "desktop" ? "com.example.app" : "http://127.0.0.1:3000"} /></label>
          <label>Goal<input className="input" name="goal" required placeholder="Open the settings page" /></label>
          <label>Expected visible text<input className="input" name="expected" required placeholder="Settings" /></label>
          {surface !== "desktop" && <label>Text selector<input className="input" name="selector" placeholder="body" /></label>}
          <p>Two-minute budget, 30 actions. Advanced assertions and action menus can be saved through the QA API. Desktop runs operate on the app’s visible accessibility controls.</p>
          <button className="btn btn-primary" type="submit" disabled={busy}>Save scenario</button>
        </form>
      </details>
      {settings && <details className={styles.section}>
        <summary>Model routing</summary>
        <div className={styles.form}>
          <p>DOM and desktop use Jev 1.13 text decisions. Canvas needs images. Low confidence or a failed action escalates to the selected vision model.</p>
          <ModelSelect label="Vision fallback model" value={settings.visionModel} models={data.models} defaultOption={data.defaultModel ? "API default · " + data.defaultModel : "API default"} onChange={visionModel => setEdits(previous => ({ ...previous, visionModel, visionEffort: "" }))} />
          <EffortSelect provider="api" model={settings.visionModel || data.defaultModel} value={settings.visionEffort} remember={false} onChange={visionEffort => setEdits(previous => ({ ...previous, visionEffort }))} />
          {!data.configured.vision && <p role="status">Configure an HTTP AI provider in Setup to enable vision fallback.</p>}
          <label>Confidence threshold<select className="input" value={settings.minConfidence} onChange={event => setEdits(previous => ({ ...previous, minConfidence: Number(event.target.value) }))}>
            {[0.45, 0.65, 0.8, 0.9].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
          </select></label>
          <label className={styles.check}><input type="checkbox" checked={settings.experimentalImages} onChange={event => setEdits(previous => ({ ...previous, experimentalImages: event.target.checked }))} />Try Jev 1.14 images for canvas decisions</label>
          <p>Experimental and off by default. Sends canvas screenshots to TypeSafe before using the vision fallback. Assertions still decide every result.</p>
          <button className="btn btn-primary" disabled={busy || !Object.keys(edits).length} onClick={() => void perform(async () => { await post({ action: "settings", settings }); setEdits({}); })}>Save routing</button>
        </div>
      </details>}
    </>}
  </div>;
}
