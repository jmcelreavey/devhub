/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccentPicker } from "./AccentPicker";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { THEME_EFFECTS } from "@/lib/theme-effects";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-theme-mode", "system");
  document.documentElement.setAttribute("data-theme-preset", "graphite");
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AccentPicker theme labels", () => {
  it.each(["graphite", "hollow"])("keeps the shared theme order in the %s picker", (preset) => {
    document.documentElement.setAttribute("data-theme-preset", preset);
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const role = "button";
    expect(screen.getAllByRole(role, { name: /^Use .+ theme$/ }).map((option) => option.getAttribute("aria-label")))
      .toEqual(THEME_PRESETS.map((theme) => `Use ${theme.label} theme`));
  });

  it("explains the default and Halloween themes while saving their existing ids", () => {
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByText("Graphite Neon (Default)")).toBeInTheDocument();
    expect(screen.getByText("DevHub's default: charcoal + lime")).toBeInTheDocument();
    expect(screen.getByText("Hollow (Halloween) 🎃")).toBeInTheDocument();
    expect(screen.getByText("Spooky Halloween theme, switches on automatically in October")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use Hollow (Halloween) 🎃 theme" }));
    expect(localStorage.getItem("devhub:theme-preset")).toBe("hollow");
    expect(localStorage.getItem("devhub:theme")).toBe("system");
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Graphite Neon (Default) theme" }));
    expect(localStorage.getItem("devhub:theme-preset")).toBe("graphite");
    expect(localStorage.getItem("devhub:theme")).toBe("system");
  });

  it.each(Object.keys(THEME_EFFECTS))("renders the active %s declaration with the shared layout and reset", preset => {
    document.documentElement.setAttribute("data-theme-preset", preset);
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Theme effects" }));
    expect(screen.getByText(THEME_EFFECTS[preset].title)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(THEME_EFFECTS[preset].effects.length + 1);
    const first = THEME_EFFECTS[preset].effects[0];
    const toggle = screen.getByRole("switch", { name: first.label });
    fireEvent.click(toggle);
    expect(JSON.parse(localStorage.getItem(THEME_EFFECTS[preset].storageKey)!)[first.id]).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset this theme to defaults" }));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "Theme effects" }));
    expect(toggle).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(THEME_EFFECTS[preset].storageKey)!)[first.id]).toBe(true);
  });

  it("puts Hollow's opt-in extras in the effects section, not the theme list", () => {
    localStorage.setItem("devhub:hollow-effects", '{"atmosphere":false,"interaction":false,"sound":true}');
    document.documentElement.setAttribute("data-theme-preset", "hollow");
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.queryByText("Jump scares")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Theme effects" }));
    expect(screen.getByRole("switch", { name: "Atmosphere" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Spectral follower" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Sound" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Jump scares" })).toHaveAttribute("aria-checked", "false");
  });

  it.each([["forest", "Hearth light"], ["hollow", "Atmosphere"], ["graphite", "Neon edges"]])("keeps %s controls working for the session when storage is full", (preset, label) => {
    document.documentElement.setAttribute("data-theme-preset", preset);
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Theme effects" }));
    const toggle = screen.getByRole("switch", { name: label });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    storage.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Reset this theme to defaults" }));
  });

  it("uses the default label for the workshop's accessible name", () => {
    render(<AccentPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Theme effects" }));
    expect(screen.getByRole("region", { name: "Graphite Neon (Default) effects" })).toBeInTheDocument();
  });
});
