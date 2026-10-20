/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_TIERS, type ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";
import { ModelTierPicker } from "./ModelTierPicker";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => toast }));

const initial: ModelTierSettings = { ...DEFAULT_MODEL_TIERS, tiers: {
  cheap: { provider: "codex", model: "gpt-6", effort: "high" },
  mid: { provider: "claude", model: "opus", effort: "max" },
  heavy: { provider: "gemini", model: "custom", effort: "deep" },
} };
const agents = [
  { id: "codex", name: "Codex", ready: true, models: ["gpt-6", "plain"] },
  { id: "claude", name: "Claude", ready: true, models: ["opus"] },
  { id: "gemini", name: "Gemini", ready: true, models: ["custom"], thinking: { custom: [{ id: "brief", label: "Brief" }, { id: "deep", label: "Deep thinking" }] } },
  { id: "glm", name: "GLM", ready: true, models: ["glm-5"] },
];
let saved: ModelTierSettings;
let submitted: ModelTierSettings | undefined;
const row = (tier: string) => within(screen.getByRole("group", { name: tier + " tier" }));

beforeEach(() => {
  vi.clearAllMocks();
  saved = structuredClone(initial);
  submitted = undefined;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/agent/connection") return { ok: true, json: async () => ({ agents, defaultAgentId: "codex" }) };
    if (init?.method === "PUT") {
      submitted = JSON.parse(String(init.body)) as ModelTierSettings;
      saved = submitted;
    }
    return { ok: true, json: async () => ({ settings: saved }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function loaded() {
  await waitFor(() => expect(row("Heavy").getByLabelText("Effort")).toHaveValue("deep"));
}

describe("ModelTierPicker", () => {
  it("renders Effort for every tier using the model table or Paseo options", async () => {
    render(<ModelTierPicker />);
    await loaded();
    expect(screen.getAllByLabelText("Effort")).toHaveLength(3);
    expect(within(row("Cheap").getByLabelText("Effort")).getByRole("option", { name: "Extra high" })).toBeTruthy();
    expect(within(row("Mid").getByLabelText("Effort")).getByRole("option", { name: "Max" })).toBeTruthy();
    expect(within(row("Heavy").getByLabelText("Effort")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Default", "Brief", "Deep thinking"]);
  });

  it("clears invalid effort and hides the selector when the next model has no levels", async () => {
    render(<ModelTierPicker />);
    await loaded();
    fireEvent.change(row("Cheap").getByLabelText("Model"), { target: { value: "plain" } });
    expect(row("Cheap").queryByLabelText("Effort")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as defaults" }));
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted!.tiers.cheap).not.toHaveProperty("effort");
    fireEvent.change(row("Cheap").getByLabelText("Model"), { target: { value: "gpt-6" } });
    expect(row("Cheap").getByLabelText("Effort")).toHaveValue("");
  });

  it("changes options and falls back to Default when the agent changes", async () => {
    render(<ModelTierPicker />);
    await loaded();
    fireEvent.change(row("Cheap").getByLabelText("Agent"), { target: { value: "glm" } });
    const effort = row("Cheap").getByLabelText("Effort");
    expect(effort).toHaveValue("");
    expect(within(effort).getAllByRole("option").map((option) => option.textContent)).toEqual(["Default", "On", "Off"]);
  });

  it("saves tier effort independently of remembered launch effort and restores it on reload", async () => {
    const rendered = render(<ModelTierPicker />);
    await loaded();
    fireEvent.change(row("Cheap").getByLabelText("Effort"), { target: { value: "low" } });
    fireEvent.change(row("Mid").getByLabelText("Effort"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as defaults" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(submitted!.tiers.cheap.effort).toBe("low");
    expect(submitted!.tiers.mid).not.toHaveProperty("effort");
    expect(submitted!.tiers.heavy.effort).toBe("deep");
    expect(localStorage.getItem("devhub:effort:codex:gpt-6")).toBeNull();
    rendered.unmount();
    render(<ModelTierPicker />);
    await loaded();
    expect(row("Cheap").getByLabelText("Effort")).toHaveValue("low");
    expect(row("Mid").getByLabelText("Effort")).toHaveValue("");
  });

  it("uses the preferred agent for an empty provider and keeps legacy effort unset", async () => {
    saved = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, cheap: { provider: "", model: "gpt-6" } } };
    render(<ModelTierPicker />);
    await waitFor(() => expect(row("Cheap").getByLabelText("Model")).toHaveValue("gpt-6"));
    expect(row("Cheap").getByLabelText("Effort")).toHaveValue("");
  });
});
