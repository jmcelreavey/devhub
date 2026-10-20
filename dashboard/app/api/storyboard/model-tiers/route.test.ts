import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";

let notesDir: string;
vi.mock("@/lib/notes/dir", () => ({ getNotesDir: () => notesDir }));
vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()), requireDashboardAuth: () => ({ ok: true }),
}));
const { GET, PUT } = await import("./route");
const url = "http://localhost:1337/api/storyboard/model-tiers";
const put = (body: unknown) => PUT(new NextRequest(url, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

beforeEach(() => { notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tier-settings-")); });
afterEach(() => { fs.rmSync(notesDir, { recursive: true, force: true }); });

describe("/api/storyboard/model-tiers", () => {
  it("keeps old settings unchanged and round-trips effort through PUT and GET", async () => {
    expect(await (await put(DEFAULT_MODEL_TIERS)).json()).toEqual({ settings: DEFAULT_MODEL_TIERS });
    const settings = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, mid: { provider: "codex", model: "gpt-6", effort: "high" } } };
    const response = await put(settings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings });
    expect(await (await GET(new NextRequest(url))).json()).toEqual({ settings });
  });
});
