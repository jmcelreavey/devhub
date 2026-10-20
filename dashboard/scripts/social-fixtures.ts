/**
 * Synthetic provider responses for the social recording only.
 * Every write is intercepted; Jira transitions and external traffic always fail closed.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Route } from "@playwright/test";
import type { TaskWorkflow } from "../lib/workflows/types";

export const SOCIAL_TASK = "social-demo-webhook";
export const SOCIAL_TITLE = "Prevent duplicate webhook receipts";
export const SOCIAL_DATE = "2026-10-12";
export const SOCIAL_RUN = "social-demo-implementation";
const NOW = SOCIAL_DATE + "T10:00:00.000Z";

export function assertSocialFixture(): { origin: string; fixture: string } {
  const fixture = fs.realpathSync(process.env.DEVHUB_DEMO_FIXTURE || "/tmp/devhub-social-fixture");
  const origin = new URL(process.env.DEMO_URL || "");
  if (!fs.existsSync(path.join(fixture, ".devhub-demo-fixture")) ||
      !["localhost", "127.0.0.1"].includes(origin.hostname) ||
      !origin.port || ["1337", "1339", "6767"].includes(origin.port)) {
    throw new Error("Social recordings require the marked, disposable demo fixture and a dedicated loopback port");
  }
  return { origin: origin.origin, fixture };
}

export async function socialStubs(context: BrowserContext) {
  const { origin, fixture } = assertSocialFixture();
  const violations: string[] = [];
  let launched = false;
  let phase: "implement" | "review" | "published" = "implement";
  let update = 0;
  const workflow: TaskWorkflow = {
    version: 1, taskId: SOCIAL_TASK, revision: 1, seenRevision: 1,
    stage: "implement", status: "active", checks: [], reviews: [], proposals: [], events: [],
  };
  const task = {
    id: SOCIAL_TASK, text: SOCIAL_TITLE, date: SOCIAL_DATE, startDate: SOCIAL_DATE, done: false,
    jiraKey: "DEMO-142", notePath: "tasks/demo-webhook",
    links: [{ kind: "jira", id: "DEMO-142", href: "https://jira.example.invalid/browse/DEMO-142" },
      { kind: "repo", id: "demo/payments-api" }],
  };
  const json = (route: Route, value: unknown) => route.fulfill({ json: value });
  const messages = ["Reading DEMO-142 and the implementation plan", "Editing src/webhooks.ts",
    "Adding duplicate-event regression coverage", "Running npm run verify"];
  function progress() {
    workflow.events = messages.slice(0, update + 1).map((summary, i) => ({ id: String(i), at: NOW, summary }));
    workflow.revision++;
  }
  function review() {
    phase = "review";
    workflow.stage = "approve";
    workflow.status = "waiting-user";
    workflow.checks = [{ id: "checks", runId: SOCIAL_RUN, fingerprint: "demo-diff",
      command: "npm run verify", startedAt: NOW, finishedAt: NOW, exitCode: 0, outcome: "passed",
      detail: "Lint, typecheck and 24 tests passed" }];
    workflow.reviews = [{ runId: "social-demo-review", fingerprint: "demo-diff",
      findings: "Duplicate events return the existing receipt. Regression coverage passes.",
      verdict: "pass", recordedAt: NOW }];
    workflow.proposals = [{ id: "social-demo-proposal", kind: "draft-pr", runId: SOCIAL_RUN,
      fingerprint: "demo-diff", destination: "demo/payments-api · main",
      content: "Prevent duplicate webhook receipts\n\nDEMO-142 · 2 files changed\nChecks passed · review accepted",
      contentHash: "a".repeat(64), expiresAt: new Date(Date.now() + 900_000).toISOString(), state: "pending" }];
    workflow.events.push({ id: "review", at: NOW, summary: "Checks passed; review accepted. Ready for your approval." });
    workflow.revision++;
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // The Git view asks for avatars for the invented fixture authors. Fulfil locally;
    // even a hashed demo email must not leave this recording context.
    if (url.origin === "https://www.gravatar.com" && request.resourceType() === "image") {
      return route.fulfill({ contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#37414b"/></svg>' });
    }
    if (url.origin !== origin) {
      if (!["data:", "blob:"].includes(url.protocol)) violations.push("external: " + url.origin);
      return route.abort("blockedbyclient");
    }
    const p = url.pathname;
    // A recording must never change even a fixture Jira status.
    if (p.includes("transition")) {
      violations.push("Jira transition attempted");
      return route.abort("blockedbyclient");
    }
    if (p === "/api/jira/tickets") return json(route, { configured: true, tickets: [
      { key: "DEMO-142", summary: SOCIAL_TITLE, status: "To Do", priority: "High",
        issuetype: "Task", project: "Demo", projectKey: "DEMO",
        url: "https://jira.example.invalid/browse/DEMO-142", updatedAt: NOW },
      { key: "DEMO-143", summary: "Add queue-age monitoring", status: "To Do", priority: "Medium",
        issuetype: "Task", project: "Demo", projectKey: "DEMO",
        url: "https://jira.example.invalid/browse/DEMO-143", updatedAt: SOCIAL_DATE + "T09:00:00.000Z" },
    ] });
    if (p === "/api/status/lan") return json(route, { addresses: [] });
    if (p === "/api/agent/connection") return json(route, { connected: true,
      defaultAgentId: "codex", defaultCwd: path.join(fixture, "repos/payments-api"),
      agents: [{ id: "codex", name: "Codex", ready: true, models: ["gpt-6-sol"] },
        { id: "claude", name: "Claude", ready: true, models: ["sonnet"] }] });
    if (p === "/api/tasks" && request.method() === "POST") return json(route, task);
    if (p === "/api/tasks/implement/ready") return json(route, { ok: true, items: [
      { id: "acceptance", label: "Acceptance criteria in DEMO-142", ok: true },
      { id: "repo", label: "payments-api linked", ok: true },
    ], taskId: SOCIAL_TASK, date: SOCIAL_DATE, notePath: task.notePath, noteExists: true,
    repoIds: ["demo/payments-api"], prefsHardBlock: false });
    if (p === "/api/tasks/implement/plan") return json(route, { repoPath: path.join(fixture, "repos/payments-api") });
    if (p === "/api/tasks/implement/review-settings") return json(route, { provider: "claude", model: "sonnet" });
    if (p === "/api/agent/runs" && request.method() === "POST") {
      launched = true;
      return json(route, { run: { id: SOCIAL_RUN, state: "running" } });
    }
    if (p === "/api/tasks/workflow") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { action?: string; approve?: boolean; proposalId?: string };
        if (body.action !== "decide" || !body.approve || body.proposalId !== "social-demo-proposal" || phase !== "review") {
          violations.push("Unexpected workflow write");
          return route.abort("blockedbyclient");
        }
        phase = "published";
        workflow.stage = "draft-pr";
        workflow.proposals[0].state = "succeeded";
        workflow.events.push({ id: "pr", at: NOW, summary: "Draft PR #142 created · DEMO-142 linked" });
        workflow.revision++;
      }
      return json(route, { task, workflow, runs: [{
        runId: SOCIAL_RUN, role: "implement", provider: "codex",
        status: phase === "implement" ? "running" : "done",
        cwd: path.join(fixture, "repos/payments-api"), startedAt: NOW,
      }] });
    }
    if (p.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) {
      return route.fulfill({ status: 403, json: { error: "Unstubbed demo write blocked" } });
    }
    return route.continue();
  });
  progress();
  return {
    review,
    progress: () => { update = Math.min(update + 1, messages.length - 1); progress(); },
    assert: () => {
      if (!launched) throw new Error("The ticket never launched its fixture agent");
      if (phase !== "published") throw new Error("The draft PR proposal was not approved");
      if (violations.length) throw new Error(violations.join("\n"));
    },
  };
}
