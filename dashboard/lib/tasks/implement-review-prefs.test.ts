import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const {
  DEFAULT_IMPLEMENT_REVIEW_PREFS,
  normalizeImplementReviewPrefs,
  readImplementReviewPrefs,
  reviewerForPlan,
  saveImplementReviewPrefs,
} = await import("./implement-review-prefs");

const prefsFile = () => path.join(notesDir, ".config", "implement-review.json");

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-implement-review-"));
});

afterEach(() => {
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("implement review prefs", () => {
  it("defaults to the implementing agent reviewing its own diff", () => {
    expect(readImplementReviewPrefs()).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
    expect(reviewerForPlan(readImplementReviewPrefs())).toBeNull();
  });

  it("saves a provider and model and reports them to the plan payload", async () => {
    await saveImplementReviewPrefs({ provider: "codex", model: "gpt-6-astra" });
    expect(readImplementReviewPrefs()).toEqual({ provider: "codex", model: "gpt-6-astra" });
    expect(reviewerForPlan(readImplementReviewPrefs())).toEqual({ provider: "codex", model: "gpt-6-astra" });
  });

  it("reports a null model when the provider's default is wanted", async () => {
    await saveImplementReviewPrefs({ provider: "claude" });
    expect(reviewerForPlan(readImplementReviewPrefs())).toEqual({ provider: "claude", model: null });
  });

  it("keeps the model when only the model changes", async () => {
    await saveImplementReviewPrefs({ provider: "codex", model: "gpt-6-astra" });
    await saveImplementReviewPrefs({ model: "gpt-6-sol" });
    expect(readImplementReviewPrefs()).toEqual({ provider: "codex", model: "gpt-6-sol" });
  });

  it("clears the model when the provider changes, since model ids are provider-specific", async () => {
    await saveImplementReviewPrefs({ provider: "codex", model: "gpt-6-astra" });
    await saveImplementReviewPrefs({ provider: "claude" });
    expect(readImplementReviewPrefs()).toEqual({ provider: "claude", model: "" });
  });

  it("lets a blank provider switch the feature back off, dropping the model with it", async () => {
    await saveImplementReviewPrefs({ provider: "codex", model: "gpt-6-astra" });
    await saveImplementReviewPrefs({ provider: "" });
    expect(readImplementReviewPrefs()).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
  });

  it("rejects provider ids that are not plain identifiers", () => {
    expect(normalizeImplementReviewPrefs({ provider: "codex; rm -rf /", model: "x" })).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
    expect(normalizeImplementReviewPrefs({ provider: "../etc", model: "x" })).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
    expect(normalizeImplementReviewPrefs({ provider: "   " })).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
  });

  it("trims and caps the model", () => {
    expect(normalizeImplementReviewPrefs({ provider: " codex ", model: "  gpt-6-astra  " })).toEqual({
      provider: "codex",
      model: "gpt-6-astra",
    });
    expect(normalizeImplementReviewPrefs({ provider: "codex", model: "m".repeat(500) }).model).toHaveLength(120);
  });

  it("ignores a corrupt or wrong-version file", () => {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), "{not json");
    expect(readImplementReviewPrefs()).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
    fs.writeFileSync(prefsFile(), JSON.stringify({ version: 99, prefs: { provider: "codex" } }));
    expect(readImplementReviewPrefs()).toEqual(DEFAULT_IMPLEMENT_REVIEW_PREFS);
  });
});
