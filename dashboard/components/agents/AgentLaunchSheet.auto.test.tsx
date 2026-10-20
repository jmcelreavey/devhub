// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";

const ui = vi.hoisted(() => ({ profile: "work", push: vi.fn(), close: vi.fn(), started: vi.fn(), toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ui.push }), usePathname: () => "/tasks" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: (url: string) => ({ data: url === "/api/tasks/profiles" ? { active: ui.profile } : undefined }) }));
vi.mock("@/components/shell/WorkspaceTabs", () => ({ useWorkspaceTabs: () => ({ openHref: vi.fn(), canOpen: true }) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));

import { AgentLaunchForm } from "./AgentLaunchSheet";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";
import { profileKey } from "@/lib/tasks/profile-scope";

const generated = "Generated default\nBuilt-in instructions.";
const intent = { requestId: "launch-request", title: "Implement with agent", prompt: generated, cwd: "/repo/app", repoName: "app", taskId: "task-auto", taskDate: "2026-10-19", stage: "implement" as const };
let request: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); ui.profile = "work";
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  request = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/agent/connection") return Response.json({ connected: true, defaultAgentId: "codex", agents: [
      { id: "codex", name: "Codex", ready: true, models: ["gpt-6-sol", "other"], thinking: { "gpt-6-sol": [{ id: "high", label: "High" }] } },
      { id: "claude", name: "Claude", ready: true, models: ["review-model"] },
    ] });
    if (url === "/api/storyboard/model-tiers") return Response.json({ settings: DEFAULT_MODEL_TIERS });
    if (url === "/api/tasks/implement/review-settings") return Response.json({ provider: "claude", model: "review-model", effort: "high" });
    if (url === "/api/storyboard/orchestrate") return Response.json({ runId: "run-plan", summary: { status: "running" } });
    return Response.json({});
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function form(allowAuto = true, taskIntent = intent) {
  return <AgentLaunchForm intent={taskIntent} current={() => true} close={ui.close} onStarted={ui.started} allowAuto={allowAuto} tierStep="implement" />;
}
async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
  await screen.findByLabelText(/^Review model/);
}
const starts = () => request.mock.calls.filter(([url]) => url === "/api/storyboard/orchestrate");

describe("task auto launch", () => {
  it("does not re-render the sheet when instructions are typed on auto", async () => {
    let commits = 0;
    render(<Profiler id="auto-launch" onRender={() => { commits += 1; }}>{form()}</Profiler>);
    await ready();
    fireEvent.click(screen.getByLabelText("Run on auto"));
    commits = 0;
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: `${generated}\nExtra instructions` } });
    expect(commits).toBe(0);
  });
  it("requires both opt-in and a new task implementation", async () => {
    const { rerender } = render(form(false));
    await ready();
    expect(screen.queryByLabelText("Run on auto")).not.toBeInTheDocument();
    rerender(form(true, { ...intent, taskId: "" }));
    expect(screen.queryByLabelText("Run on auto")).not.toBeInTheDocument();
    rerender(form());
    expect(screen.getByLabelText("Run on auto")).not.toBeChecked();
    expect(screen.queryByLabelText("Pause after planning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Run on auto"));
    expect(screen.getByLabelText("Pause after planning")).toBeChecked();
    expect(screen.getByRole("button", { name: "Start on auto" })).toBeEnabled();
  });

  it("remembers auto per profile without remembering a disabled planning pause", async () => {
    const view = render(form());
    await ready();
    fireEvent.click(screen.getByLabelText("Run on auto"));
    fireEvent.click(screen.getByLabelText("Pause after planning"));
    expect(localStorage.getItem(profileKey("devhub:agent-run-on-auto", "work")!)).toBe("true");
    ui.profile = "personal"; view.rerender(form());
    expect(screen.getByLabelText("Run on auto")).not.toBeChecked();
    ui.profile = "work"; view.rerender(form());
    expect(screen.getByLabelText("Run on auto")).toBeChecked();
    view.unmount(); render(form());
    expect(screen.getByLabelText("Pause after planning")).toBeChecked();
  });

  it.each([true, false])("starts auto with the selected settings and pause=%s, never a chat", async (pause) => {
    render(form()); await ready();
    fireEvent.change(screen.getByLabelText(/^Model$/), { target: { value: "gpt-6-sol" } });
    fireEvent.change(screen.getByLabelText(/^Effort$/), { target: { value: "high" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: `${generated}\nKeep the API compatible.` } });
    fireEvent.click(screen.getByLabelText("Run on auto"));
    if (!pause) fireEvent.click(screen.getByLabelText("Pause after planning"));
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    await waitFor(() => expect(ui.started).toHaveBeenCalledOnce());
    const [url, init] = starts()[0];
    expect(url).toBe("/api/storyboard/orchestrate");
    expect(new Headers(init?.headers).get("X-Devhub-Task-Profile")).toBe("work");
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: "start", taskId: intent.taskId, taskDate: intent.taskDate, cwd: "/repo/app", repoName: "app", worktree: true, instructions: "Keep the API compatible.", pauseAfterPlan: pause, stepOverrides: {
      plan: { provider: "codex", model: "gpt-6-sol", effort: "high" },
      implement: { provider: "codex", model: "gpt-6-sol", effort: "high" },
      review: { provider: "claude", model: "review-model", effort: "high" },
    } });
    expect(request.mock.calls.some(([href]) => href === "/api/agent/runs")).toBe(false);
    expect(ui.toast.success).toHaveBeenCalledWith("On auto: planning started");
    expect(ui.close).toHaveBeenCalledOnce();
  });

  it("explains checkout safety only when that setting cannot be guaranteed", async () => {
    render(form()); await ready();
    expect(screen.queryByText(/running in your checkout isn't guaranteed/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Run on auto"));
    expect(screen.queryByText(/running in your checkout isn't guaranteed/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Use an isolated worktree"));
    expect(screen.getByText(/running in your checkout isn't guaranteed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Review with/), { target: { value: "" } });
    expect(screen.getByText(/“Same agent” isn't used/)).toBeInTheDocument();
  });

  it("keeps the sheet open for an existing-run conflict", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation((url, init) => url === "/api/storyboard/orchestrate" ? Promise.resolve(Response.json({ error: "An agent is already running." }, { status: 409 })) : original(url, init));
    render(form()); await ready();
    fireEvent.click(screen.getByLabelText("Run on auto"));
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    expect((await screen.findAllByText("An agent is already running.")).length).toBeGreaterThan(0);
    expect(ui.toast.error).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
    expect(ui.started).not.toHaveBeenCalled();
  });
});
