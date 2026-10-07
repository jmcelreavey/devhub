import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

async function validate(body: Record<string, string>) {
  const response = await POST(new NextRequest("http://127.0.0.1/api/setup/validate-path", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  return response.json() as Promise<Record<string, { ok: boolean; message: string } | null>>;
}

describe("POST /api/setup/validate-path", () => {
  it("does not flag an empty optional code folder or checkout as required", async () => {
    const result = await validate({ reposDir: "", repoRoot: "  ", notesDir: "/definitely/missing/notes" });
    expect(result.reposDir).toBeNull();
    expect(result.repoRoot).toBeNull();
    expect(result.notesDir).toMatchObject({ ok: false, message: "Path does not exist" });
  });
  it("still requires the notes folder", async () => {
    expect((await validate({ notesDir: "" })).notesDir).toMatchObject({ ok: false, message: "Path is required" });
  });
  it("explains that network shares are unsupported", async () => {
    const result = await validate({ reposDir: "\\\\fileserver\\team\\code" });
    expect(result.reposDir).toMatchObject({ ok: false });
    expect(result.reposDir?.message).toMatch(/Network shares/);
  });
});
