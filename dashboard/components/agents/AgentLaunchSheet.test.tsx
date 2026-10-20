// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ push: vi.fn(), openHref: vi.fn(), toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ui.push }), usePathname: () => "/repos" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
vi.mock("@/components/shell/WorkspaceTabs", () => ({ useWorkspaceTabs: () => ({ openHref: ui.openHref, canOpen: true }) }));
import { AgentLaunchForm, AgentLaunchSheet } from "./AgentLaunchSheet";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
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
  HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
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
    expect(payload).toMatchObject({ cwd: "/project", worktree: false, provider: "claude", defer: false });
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

describe("agent selection", () => {
  function mockCatalog(data: unknown) {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) =>
      String(url) === "/api/agent/connection" ? Response.json(data) : original(url, init),
    );
  }

  function renderChooser(provider?: string) {
    render(<AgentLaunchForm
      intent={{ requestId: "chooser", title: "Choose an agent", prompt: "Create the tickets", cwd: "/project", provider }}
      current={() => true} close={() => undefined}
    />);
  }

  it.each(["missing", "not-ready"])("uses a ready agent when the remembered default is %s", async (state) => {
    localStorage.setItem("devhub:agent-choice:agent", "old-agent");
    mockCatalog({
      ...catalog,
      defaultAgentId: "old-agent",
      agents: [
        ...(state === "not-ready" ? [{ id: "old-agent", name: "Old agent", ready: false, models: [] }] : []),
        ...catalog.agents,
      ],
    });
    renderChooser();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    expect(screen.getByLabelText(/^Agent/)).toHaveValue("claude");
  });

  it("explains an explicitly selected unavailable agent without silently switching providers", async () => {
    mockCatalog({ ...catalog, agents: [
      ...catalog.agents, { id: "codex", name: "Codex", ready: false, models: [], error: "Sign in to Codex first." },
    ] });
    renderChooser("codex");
    expect(await screen.findByText("Sign in to Codex first.")).toBeTruthy();
    expect(screen.getByLabelText(/^Agent/)).toHaveValue("codex");
    expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Agent/), { target: { value: "claude" } });
    expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled();
  });

  it("restores the saved model when changing agents", async () => {
    localStorage.setItem("devhub:agent-model:agent:codex", "gpt-6-sol");
    mockCatalog({ ...catalog, agents: [
      ...catalog.agents, { id: "codex", name: "Codex", ready: true, models: ["gpt-6-sol"] },
    ] });
    renderChooser();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/^Agent/), { target: { value: "codex" } });
    expect(screen.getByLabelText(/^Model/)).toHaveValue("gpt-6-sol");
  });

  it("uses Cursor's live variants and hides effort for models without them", async () => {
    mockCatalog({
      ...catalog,
      defaultAgentId: "cursor",
      agents: [{
        id: "cursor",
        name: "Cursor",
        ready: true,
        models: [
          "grok-4.7-low",
          "grok-4.7-medium",
          "grok-4.7-high",
          "grok-4.7-xhigh",
          "composer-2.5",
        ],
      }],
    });
    renderChooser("cursor");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());

    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "composer-2.5" } });
    expect(screen.queryByLabelText(/^Effort/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "grok-4.7-xhigh" } });
    fireEvent.change(screen.getByLabelText(/^Effort/), { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));

    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload).toMatchObject({
      provider: "cursor",
      model: "grok-4.7-xhigh",
      effort: "low",
      defer: false,
    });
  });

  it("shows an inline error when Paseo returns a failed launch", async () => {
    renderChooser();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    await act(async () => accept(Response.json({
      run: { id: "failed", state: "failed", error: "Cannot use this model" },
    }, { status: 201 })));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot use this model");
    expect(screen.getByRole("dialog", { name: "Choose an agent" })).toBeTruthy();
    expect(ui.push).not.toHaveBeenCalled();
  });

  it("retries a failed connection without closing the form or starting a run", async () => {
    const original = request.getMockImplementation()!;
    let disconnected = true;
    request.mockImplementation(async (url, init) => {
      if (String(url) === "/api/agent/connection" && disconnected) {
        disconnected = false;
        return Response.json({ connected: false, error: "Paseo is unavailable." }, { status: 503 });
      }
      return original(url, init);
    });
    renderChooser();
    fireEvent.click(await screen.findByRole("button", { name: "Retry connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    expect(screen.queryByText("Paseo is unavailable.")).toBeNull();
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows a recovery path for an empty agent catalog", async () => {
    mockCatalog({ ...catalog, agents: [] });
    renderChooser();
    expect(await screen.findByText("No agents are available. Check your connection to add one.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check Agents → Connection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
    expect(screen.queryByLabelText("Loading agents")).toBeNull();
  });

  it("uses the ticket workflow labels and starts without implementation settings in Strict Mode", async () => {
    const onClose = vi.fn();
    render(<StrictMode><SkillAgentDialog
      open requireExplicitDismissal onClose={onClose} title="Choose an agent"
      description="Create the reviewed tickets and linked tasks."
      getPrompt={() => "Create the reviewed tickets"} summary="Create tickets" reason="Create tickets"
      kind="agent" worktree={false} cancelLabel="Back to review" launchButtonLabel="Launch agent"
      promptDisclosureLabel="Review agent instructions"
    /></StrictMode>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch agent" })).toBeEnabled());
    expect(screen.getByText("Create the reviewed tickets and linked tasks.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to review" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Review with/)).toBeNull();
    expect(screen.queryByLabelText("Use an isolated worktree")).toBeNull();
    expect(screen.getByLabelText("Task").closest("details")?.open).toBe(false);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload).toMatchObject({ action: "agent", worktree: false, prompt: "Create the reviewed tickets" });
    await act(async () => accept(Response.json({ run: { id: "tickets", state: "starting" } })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("background handoff", () => {
  it("keeps edited text when the form closes during preflight", async () => {
    let release!: () => void;
    const preflight = new Promise<void>((resolve) => { release = resolve; });
    const view = render(<AgentLaunchForm
      intent={{ requestId: "background", title: "Implement", prompt: "Original", cwd: "/project" }}
      current={() => false} close={() => undefined} beforeStart={() => preflight}
    />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Edited instructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    view.unmount();
    await act(async () => release());
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const call = request.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body)).prompt).toContain("Edited instructions");
    await act(async () => accept(Response.json({ run: { id: "run", state: "starting" } })));
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

  it("opens the run as soon as the record exists, before a chat id", async () => {
    renderPlan("implement");
    // The folder select is required. Clicking before the assigned repo is applied does not submit.
    await waitFor(() => expect(screen.getByLabelText("Working folder")).toHaveValue("/Users/dev/app"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Starting…");
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    await act(async () => accept(Response.json({ run: { id: "run-1", state: "starting" } })));
    expect(ui.openHref).toHaveBeenCalledWith("/agents?run=run-1", { newTab: true });
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

describe("agent limit", () => {
  it("shows which agents hold the limit when a start is refused, and lets a stale one be cleared", async () => {
    let stale = true;
    request.mockImplementation(async (url, init) => {
      const href = String(url);
      if (href === "/api/agent/connection") return Response.json(catalog);
      if (href === "/api/repos") return Response.json(repos);
      if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
      if (href === "/api/agent/runs" && init?.method === "POST") return Response.json({ error: "6 agent runs are already active: ...", code: "capacity" }, { status: 429 });
      if (href === "/api/agent/runs/capacity") {
        const runs = [{ id: "live", title: "Plan PTF-5207", providerLabel: "codex", state: "running", conversationId: "chat-live", createdAt: 1, error: null, clearable: false }];
        if (stale) runs.push({ id: "stale", title: "PTF-5041 · app#179", providerLabel: "cursor", state: "needs-attention", conversationId: "", createdAt: 1, error: "Paseo never acknowledged this start.", clearable: true } as never);
        return Response.json({ max: 2, runs });
      }
      if (href === "/api/agent/runs/stale/clear") { stale = false; return Response.json({ outcome: "cleared" }); }
      return new Response("{}", { status: 404 });
    });
    render(<AgentLaunchForm intent={{ requestId: "1", title: "Write plan with agent", prompt: "Plan it", cwd: "/project", stage: "plan" }} current={() => true} close={() => undefined} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    expect(await screen.findByText("PTF-5041 · app#179")).toBeTruthy();
    expect(screen.getByText(/All of DevHub's agent slots are in use/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByText("PTF-5041 · app#179")).toBeNull());
    expect(screen.queryByText(/All of DevHub's agent slots are in use/)).toBeNull();
  });

  it("keeps other refusals as plain text", async () => {
    request.mockImplementation(async (url, init) => {
      const href = String(url);
      if (href === "/api/agent/connection") return Response.json(catalog);
      if (href === "/api/repos") return Response.json(repos);
      if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
      if (href === "/api/agent/runs" && init?.method === "POST") return Response.json({ error: "Daily budget reached." }, { status: 429 });
      return new Response("{}", { status: 404 });
    });
    render(<AgentLaunchForm intent={{ requestId: "1", title: "Write plan with agent", prompt: "Plan it", cwd: "/project", stage: "plan" }} current={() => true} close={() => undefined} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    expect((await screen.findAllByText("Daily budget reached.")).length).toBeGreaterThan(0);
    expect(request.mock.calls.some(([url]) => String(url) === "/api/agent/runs/capacity")).toBe(false);
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
    expect(saved).toEqual({ provider: "codex", model: "gpt-6-astra", effort: "" });
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
    expect(saved).toEqual({ provider: "", model: "", effort: "" });
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


  it("sends the chosen effort with the run", async () => {
    renderIt("implement");
    fireEvent.change(await screen.findByLabelText(/^Effort/), { target: { value: "high" } });
    fireEvent.click(startChat());
    await waitFor(() => expect(methodAndUrl()).toContain("POST /api/agent/runs"));
    const call = request.mock.calls.find(([url]) => String(url) === "/api/agent/runs");
    expect(JSON.parse(String(call?.[1]?.body)).effort).toBe("high");
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

describe("model tier at launch", () => {
  const tiers = {
    tiers: { cheap: { provider: "codex", model: "mini" }, mid: { provider: "claude", model: "sonnet" }, heavy: { provider: "claude", model: "opus" } },
    steps: { plan: "mid", implement: "mid", verify: "cheap", "draft-pr": "cheap", review: "heavy" },
  };
  const agents = { ...catalog, agents: [{ id: "claude", name: "Claude", ready: true, models: ["sonnet", "opus"] }, { id: "codex", name: "Codex", ready: true, models: ["mini"] }] };
  const calls = (url: string, method?: string) => request.mock.calls.filter(([href, init]) => String(href) === url && (init?.method ?? "GET") === (method ?? "GET"));

  beforeEach(() => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) => {
      const href = String(url);
      if (href === "/api/agent/connection") return Response.json(agents);
      if (href === "/api/storyboard/model-tiers") return Response.json({ settings: tiers });
      return original(url, init);
    });
  });

  it("preselects the step's saved tier, sends the tier picked, and saves it only when asked", async () => {
    render(<AgentLaunchForm
      intent={{ requestId: "tier", title: "Implement", prompt: "Do it", cwd: "/project", taskId: "t1", taskDate: "2026-10-17", stage: "implement" }}
      current={() => true} close={() => undefined} tierStep="implement"
    />);
    const select = await screen.findByRole("combobox", { name: /Implement tier/ });
    expect(select).toHaveValue("mid");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^Agent/ })).toHaveValue("claude"));
    expect(screen.queryByRole("checkbox", { name: /as the Implement default/ })).toBeNull();
    fireEvent.change(select, { target: { value: "cheap" } });
    expect(screen.getByRole("combobox", { name: /^Agent/ })).toHaveValue("codex");
    fireEvent.click(screen.getByRole("checkbox", { name: /Save Cheap as the Implement default/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(calls("/api/agent/runs", "POST")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/agent/runs", "POST")[0][1]?.body))).toMatchObject({ provider: "codex", model: "mini", tier: "cheap", taskId: "t1", action: "implement" });
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    await waitFor(() => expect(calls("/api/storyboard/model-tiers", "PUT")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/storyboard/model-tiers", "PUT")[0][1]?.body)).steps).toMatchObject({ implement: "cheap", plan: "mid" });
  });

  it("starts on the saved tier in one click without saving anything", async () => {
    render(<AgentLaunchForm
      intent={{ requestId: "tier-2", title: "Implement", prompt: "Do it", cwd: "/project", taskId: "t1", taskDate: "2026-10-17", stage: "implement" }}
      current={() => true} close={() => undefined} tierStep="implement"
    />);
    await screen.findByRole("combobox", { name: /Implement tier/ });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(calls("/api/agent/runs", "POST")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/agent/runs", "POST")[0][1]?.body))).toMatchObject({ provider: "claude", model: "sonnet", tier: "mid" });
    expect(calls("/api/storyboard/model-tiers", "PUT")).toHaveLength(0);
  });
});
