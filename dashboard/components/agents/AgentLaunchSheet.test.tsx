// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ push: vi.fn(), openHref: vi.fn(), toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ui.push }), usePathname: () => "/repos" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
vi.mock("@/components/shell/WorkspaceTabs", () => ({ useWorkspaceTabs: () => ({ openHref: ui.openHref, canOpen: true }) }));
import { AgentLaunchForm, AgentLaunchSheet } from "./AgentLaunchSheet";
import { openAgentHandoff } from "@/lib/agent-handoff";

const catalog = {
  connected: true,
  defaultAgentId: "claude",
  defaultCwd: "/Users/example/Library/Application Support/DevHub",
  agents: [{ id: "claude", name: "Claude", ready: true, models: [] }],
};
const repos = {
  repos: [
    { name: "sample-svc", path: "/Users/dev/sample-svc" },
    { name: "app", path: "/Users/dev/app" },
  ],
  scanDirDisplay: "~/Developer",
};
let accept: (response: Response) => void;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  request = vi.fn<typeof fetch>(async (url) => {
    const href = String(url);
    if (href === "/api/agent/connection") return Response.json(catalog);
    if (href === "/api/repos") return Response.json(repos);
    if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
    if (href === "/api/tasks/implement/review-settings") return Response.json({ provider: "", model: "" });
    return await new Promise<Response>(resolve => { accept = resolve; });
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => act(() => openAgentHandoff({ title: "Explain output", context: "  exact output\n$ dangerous-looking-text", cwd: "/project", worktree: false }));
describe("agent handoff", () => {
  it("captures quoted context without sending until Start chat is clicked", async () => {
    render(<AgentLaunchSheet />); open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "What would you like the agent to do?" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload.prompt).toContain(">   exact output\n> $ dangerous-looking-text");
    expect(payload).toMatchObject({ cwd: "/project", worktree: false, provider: "claude" });
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    expect(ui.push).toHaveBeenCalledWith("/agents?conversation=chat");
  });
  it("does not navigate or close a newer handoff when an earlier start finishes", async () => {
    render(<AgentLaunchSheet />); open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "What would you like the agent to do?" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    act(() => openAgentHandoff({ title: "A newer task", prompt: "Other work", cwd: "/project" }));
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    expect(ui.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "A newer task" })).toBeTruthy();
  });
});

describe("working folder", () => {
  function renderPlan(stage: "plan" | "implement" = "plan") {
    render(
      <AgentLaunchForm
        intent={{ requestId: "1", title: "Write plan with agent", runTitle: "Plan · PTF-5014 · Analytics overlay", prompt: "Write the plan", repoName: "app", stage }}
        current={() => true}
        close={() => undefined}
        resolveCwd={async () => "/wrong"}
      />,
    );
  }

  it("defaults to the assigned repo instead of the workspace fallback", async () => {
    renderPlan();
    await waitFor(() => expect(screen.getByLabelText("Working folder")).toHaveValue("/Users/dev/app"));
    expect(screen.getByLabelText("Working folder")).not.toHaveValue(catalog.defaultCwd);
    expect(screen.getByText("/Users/dev/app")).toBeTruthy();
  });

  it.each(["plan", "implement"] as const)("submits the selected repo and opens %s in a new tab", async (stage) => {
    renderPlan(stage);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Working folder"), { target: { value: "/Users/dev/sample-svc" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload).toMatchObject({ cwd: "/Users/dev/sample-svc", repoName: "sample-svc", title: "Plan · PTF-5014 · Analytics overlay" });
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    expect(ui.openHref).toHaveBeenCalledWith("/agents?conversation=chat", { newTab: true });
    expect(ui.push).not.toHaveBeenCalled();
  });

  it("offers GitHub clone when the assigned repo is not on disk", async () => {
    request.mockImplementation(async (url) => {
      const href = String(url);
      if (href === "/api/agent/connection") return Response.json(catalog);
      if (href === "/api/repos") return Response.json({ repos: [{ name: "sample-svc", path: "/Users/dev/sample-svc" }], scanDirDisplay: "~/Developer" });
      if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
      return await new Promise<Response>(resolve => { accept = resolve; });
    });
    renderPlan();
    await waitFor(() => expect(screen.getByText(/Linked repo “app” isn’t in ~\/Developer/)).toBeTruthy());
    expect(screen.getByLabelText("GitHub repo")).toBeTruthy();
  });
});

describe("review assistant", () => {
  const twoAgents = {
    ...catalog,
    agents: [
      { id: "claude", name: "Claude", ready: true, models: [] },
      { id: "codex", name: "Codex", ready: true, models: ["gpt-6-astra", "gpt-6-sol"] },
    ],
  };
  let saved: { provider: string; model: string };
  let saveStatus = 200;

  beforeEach(() => {
    saved = { provider: "", model: "" };
    saveStatus = 200;
    request.mockImplementation(async (url, init) => {
      const href = String(url);
      if (href === "/api/agent/connection") return Response.json(twoAgents);
      if (href === "/api/repos") return Response.json(repos);
      if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
      if (href === "/api/tasks/implement/review-settings") {
        if (init?.method !== "PUT") return Response.json(saved);
        if (saveStatus !== 200) return Response.json({ error: "Disk is full." }, { status: saveStatus });
        saved = JSON.parse(String(init.body));
        return Response.json(saved);
      }
      return await new Promise<Response>(resolve => { accept = resolve; });
    });
  });

  function renderIt(stage: "plan" | "implement") {
    render(
      <AgentLaunchForm
        intent={{ requestId: "1", title: "Implement with agent", prompt: "Do it", repoName: "app", stage }}
        current={() => true}
        close={() => undefined}
      />,
    );
  }
  const methodAndUrl = () => request.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);
  const startChat = () => screen.getByRole("button", { name: "Start chat" });

  it("is only offered when implementing", async () => {
    renderIt("plan");
    await waitFor(() => expect(startChat()).toBeEnabled());
    expect(screen.queryByLabelText(/^Review with/)).toBeNull();
    expect(methodAndUrl().some((call) => call.includes("review-settings"))).toBe(false);
  });

  it("defaults to the implementing agent reviewing its own diff", async () => {
    renderIt("implement");
    expect(await screen.findByLabelText(/^Review with/)).toHaveValue("");
    expect(screen.getByLabelText(/^Review model/)).toBeDisabled();
    expect(screen.getByText(/The implementing agent reviews its own diff/)).toBeTruthy();
  });

  it("shows the saved reviewer and its models", async () => {
    saved = { provider: "codex", model: "gpt-6-sol" };
    renderIt("implement");
    await waitFor(() => expect(screen.getByLabelText(/^Review with/)).toHaveValue("codex"));
    expect(screen.getByLabelText(/^Review model/)).toHaveValue("gpt-6-sol");
    expect(screen.getByText(/That assistant reviews the finished diff/)).toBeTruthy();
  });

  it("saves a changed choice before it starts the run", async () => {
    renderIt("implement");
    fireEvent.change(await screen.findByLabelText(/^Review with/), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText(/^Review model/), { target: { value: "gpt-6-astra" } });
    await waitFor(() => expect(startChat()).toBeEnabled());
    fireEvent.click(startChat());
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const calls = methodAndUrl();
    expect(calls.indexOf("PUT /api/tasks/implement/review-settings")).toBeGreaterThan(-1);
    expect(calls.indexOf("PUT /api/tasks/implement/review-settings")).toBeLessThan(calls.indexOf("POST /api/agent/runs"));
    expect(saved).toEqual({ provider: "codex", model: "gpt-6-astra" });
  });

  it("clears the model when a different reviewer is picked", async () => {
    saved = { provider: "codex", model: "gpt-6-sol" };
    renderIt("implement");
    await waitFor(() => expect(screen.getByLabelText(/^Review model/)).toHaveValue("gpt-6-sol"));
    fireEvent.change(screen.getByLabelText(/^Review with/), { target: { value: "claude" } });
    expect(screen.getByLabelText(/^Review model/)).toHaveValue("");
  });

  it("switches back to the same agent with a blank provider", async () => {
    saved = { provider: "codex", model: "gpt-6-sol" };
    renderIt("implement");
    await waitFor(() => expect(screen.getByLabelText(/^Review with/)).toHaveValue("codex"));
    fireEvent.change(screen.getByLabelText(/^Review with/), { target: { value: "" } });
    await waitFor(() => expect(startChat()).toBeEnabled());
    fireEvent.click(startChat());
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    expect(saved).toEqual({ provider: "", model: "" });
  });

  it("does not write anything when the choice is unchanged", async () => {
    renderIt("implement");
    await screen.findByLabelText(/^Review with/);
    await waitFor(() => expect(startChat()).toBeEnabled());
    fireEvent.click(startChat());
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    expect(methodAndUrl()).not.toContain("PUT /api/tasks/implement/review-settings");
  });

  it("shows a failed save and does not start the run", async () => {
    saveStatus = 500;
    renderIt("implement");
    fireEvent.change(await screen.findByLabelText(/^Review with/), { target: { value: "codex" } });
    await waitFor(() => expect(startChat()).toBeEnabled());
    fireEvent.click(startChat());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Disk is full."));
    expect(methodAndUrl()).not.toContain("POST /api/agent/runs");
  });

  it("does not hide the launch when the saved reviewer can't be read", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) => {
      if (String(url) === "/api/tasks/implement/review-settings") return Response.json({ error: "nope" }, { status: 500 });
      return original(url, init);
    });
    renderIt("implement");
    await waitFor(() => expect(startChat()).toBeEnabled());
    expect(screen.queryByLabelText(/^Review with/)).toBeNull();
  });
});
