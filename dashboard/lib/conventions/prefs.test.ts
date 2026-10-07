import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const { DEFAULT_CONVENTIONS_PREFS, conventionsPrefsFilePath, normalizeConventionsPrefs, readConventionsPrefs, saveConventionsPrefs } =
  await import("./prefs");

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conv-prefs-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("conventions prefs", () => {
  it("defaults to on, with no provider or model override", () => {
    expect(readConventionsPrefs()).toEqual(DEFAULT_CONVENTIONS_PREFS);
    expect(DEFAULT_CONVENTIONS_PREFS).toMatchObject({ enabled: true, provider: "", model: "" });
  });

  it("saves a partial patch onto what is there", async () => {
    await saveConventionsPrefs({ model: "claude-opus-4", provider: "cursor-cli" });
    await saveConventionsPrefs({ enabled: false });
    expect(readConventionsPrefs()).toMatchObject({ enabled: false, model: "claude-opus-4", provider: "cursor-cli" });
  });

  it("ignores legacy approval settings and preserves the mining model", () => {
    const file = conventionsPrefsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, prefs: { autoAccept: false, autoActivateAt: 5, model: "big-model" } }));
    expect(readConventionsPrefs()).toMatchObject({ enabled: true, model: "big-model" });
    expect(readConventionsPrefs()).not.toHaveProperty("autoAccept");
    expect(readConventionsPrefs()).not.toHaveProperty("autoActivateAt");
  });

  it("clamps numbers into their ranges", () => {
    expect(normalizeConventionsPrefs({ prLimit: 500, minIntervalHours: 99999 })).toMatchObject({
      prLimit: 50,
      minIntervalHours: 168,
    });
    expect(normalizeConventionsPrefs({ prLimit: 1 }).prLimit).toBe(5);
  });

  it("falls back to the default provider for anything it does not know", () => {
    expect(normalizeConventionsPrefs({ provider: "gpt-9000" as never }).provider).toBe("");
    expect(normalizeConventionsPrefs({ provider: "codex" as never }).provider).toBe("chatgpt-cli");
  });

  it("lets a blank provider clear an earlier choice", async () => {
    await saveConventionsPrefs({ provider: "opencode" });
    await saveConventionsPrefs({ provider: "" });
    expect(readConventionsPrefs().provider).toBe("");
  });

  it("trims the model", async () => {
    await saveConventionsPrefs({ model: "  grok-4.6  " });
    expect(readConventionsPrefs().model).toBe("grok-4.6");
  });

  it("ignores a corrupt or wrong-version file", () => {
    const file = conventionsPrefsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, prefs: { enabled: false } }));
    expect(readConventionsPrefs()).toEqual(DEFAULT_CONVENTIONS_PREFS);
    fs.writeFileSync(file, "{not json");
    expect(readConventionsPrefs()).toEqual(DEFAULT_CONVENTIONS_PREFS);
  });
});
