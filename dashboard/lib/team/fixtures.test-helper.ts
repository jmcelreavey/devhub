import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { Task } from "@shared/tasks/types.ts";
import type { GatewayClient } from "@/lib/integrations/slack/gateway-client";
import type { TeamEnvironment } from "./environment";
import { ToolConfirmStore } from "@/lib/integrations/slack/tool-confirm-store";
import { teamDependencies } from "./dependencies";
import { TeamCollaboration } from "./collaboration";
import { TeamStore } from "./store";
import type { TeamTaskContext } from "./context";
export function teamFixture(userId = "U1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-team-test-"));
  let now = Date.now();
  const audience = { teamId: "T1", userId, deviceId: "device-" + userId, profile: "work" };
  const task: Task = { id: "task-one", text: "APP-1 Fix the task", jiraKey: "APP-1", createdAt: "2026-10-19T00:00:00Z", startDate: "2026-10-19", rank: "a", done: false };
  const context: TeamTaskContext = { task, profile: "work", question: { id: "q1", text: "Keep the last result?" }, sections: [task.text, "Question: Keep the last result?"], note: "Summary: Fix the task\nState: Waiting\nNext steps: Apply the answer\nQuestion: Keep the last result?", runs: [], cwd: "/fake/repo", branch: "feature/task" };
  const questions = { closed: false, questions: [{ id: "q1", text: "Keep the last result?", kind: "note" as const }] };
  const tasks = new Map([[task.id, task]]);
  let sequence = 10;
  const client = { listMembers: vi.fn(async () => [{ userId: userId === "U1" ? "U2" : "U1", userName: userId === "U1" ? "helper" : "owner" }]), askTeammate: vi.fn(async () => ({ channel: "GDM", ts: "1.000" })), handoff: vi.fn(async () => ({ channel: "D2", ts: "2.000" })), handoffResolve: vi.fn(async () => undefined), handoffStatus: vi.fn(async () => []) } as unknown as GatewayClient;
  const deps = { ...teamDependencies,
    context: vi.fn(async () => { if (task.handoff) throw new Error("read-only"); return context; }),
    questions: vi.fn(() => questions), answer: vi.fn(async () => { questions.questions = []; return { remaining: 0 }; }),
    getTask: vi.fn((taskId: string) => tasks.get(taskId) ?? null),
    setHandoff: vi.fn((_taskId: string, _profile: string, handoff: Task["handoff"]) => { task.handoff = handoff; }),
    cancelRuns: vi.fn(async () => undefined), inspect: vi.fn(async () => ({ cwd: "/fake/repo", branch: "feature/task", repo: "github.com/org/app", files: [] as string[], fingerprint: "clean" })), push: vi.fn(async () => undefined), writeNote: vi.fn(),
    repos: vi.fn(async () => [{ name: "app", path: "/fake/repo", origin: "github.com/org/app" }] as Awaited<ReturnType<typeof teamDependencies.repos>>),
    fetchWorktree: vi.fn(async () => ({ cwd: "/fake/worktree", branch: "feature/task" })),
    createPickup: vi.fn((bundle: Parameters<typeof teamDependencies.createPickup>[0], _profile: string, checkout: { cwd: string; branch: string }) => { const pickup = { ...task, id: bundle.handoffId, handoff: undefined, stage: "draft" as const, teamPickup: { handoffId: bundle.handoffId, ...checkout, status: "pending" as const } }; tasks.set(pickup.id, pickup); return pickup; }),
    holdPickup: vi.fn((taskId: string, _profile: string, handoffId: string, checkout: { cwd: string; branch: string }) => { tasks.get(taskId)!.teamPickup = { handoffId, ...checkout, status: "pending" }; }),
    finishPickup: vi.fn((taskId: string, _profile: string, bundle: Parameters<typeof teamDependencies.finishPickup>[2], checkout: { cwd: string; branch: string }) => { tasks.get(taskId)!.teamPickup = { handoffId: bundle.handoffId, ...checkout }; tasks.get(taskId)!.stage = undefined; }),
    retirePickup: vi.fn((taskId: string) => { Object.assign(tasks.get(taskId)!, { abandonedAt: new Date().toISOString(), endDate: "2026-10-19", abandonReason: "Handoff was declined/expired" }); }),
    jiraConnected: vi.fn(() => true), assignJira: vi.fn(async () => undefined),
  } satisfies typeof teamDependencies;
  const env = { client, deps, audience: () => audience, channel: userId.replace("U", "D"), ownerName: userId === "U1" ? "owner" : "helper", store: new TeamStore(root, () => now), confirms: new ToolConfirmStore(root, () => now, () => audience.deviceId), post: vi.fn<TeamEnvironment["post"]>(async () => ({ channel: userId.replace("U", "D"), ts: String(sequence++) + ".000" })), update: vi.fn<TeamEnvironment["update"]>(async () => undefined), active: () => true };
  return { service: new TeamCollaboration(env), env, context, task, tasks, questions, root, advance: (milliseconds: number) => { now += milliseconds; }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
