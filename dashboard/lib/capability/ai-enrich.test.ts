import { generateText } from "ai";
import { getNotesAiModel } from "@/lib/ai-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichSignalsWithAi } from "./ai-enrich";
import type { ScanFile } from "./detectors";
import type { DetectedSignal } from "./types";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@/lib/ai-provider", () => ({
  getNotesAiModel: vi.fn(),
  getNotesAiCallOptions: vi.fn(() => ({})),
}));

function file(path: string, content?: string): ScanFile {
  const base = path.split("/").pop()!.toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot) : "";
  return { path, base, ext, content };
}

const existing: DetectedSignal[] = [{ id: "node", label: "Node.js", kind: "technology", area: "runtime", evidence: ["package.json"], count: 1, confidence: 0.6 }];

describe("capability AI enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds AI-suggested signals only when evidence matches compact repo facts", async () => {
    vi.mocked(getNotesAiModel).mockReturnValue({} as never);
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        signals: [
          { id: "prisma", label: "Prisma", kind: "technology", area: "data", evidence: ["package.json"], match: "prisma" },
          { id: "django", label: "Django", kind: "technology", area: "runtime", evidence: ["missing.py"], match: "django" },
        ],
      }),
      finishReason: "stop",
    } as never);

    const signals = await enrichSignalsWithAi([
      file("package.json", '{"dependencies":{"prisma":"^6.0.0"}}'),
    ], existing);

    expect(signals.map((s) => s.id)).toContain("prisma");
    expect(signals.map((s) => s.id)).not.toContain("django");
  });

  it("does nothing when AI is not configured", async () => {
    vi.mocked(getNotesAiModel).mockReturnValue(null);
    const signals = await enrichSignalsWithAi([file("package.json", '{"dependencies":{"prisma":"^6.0.0"}}')], existing);
    expect(signals).toBe(existing);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects path-token suggestions with unrelated evidence", async () => {
    vi.mocked(getNotesAiModel).mockReturnValue({} as never);
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        signals: [
          { id: "made-up", label: "Made Up", kind: "technology", area: "data", evidence: ["package.json"], match: "README.md" },
        ],
      }),
      finishReason: "stop",
    } as never);

    const signals = await enrichSignalsWithAi([
      file("README.md"),
      file("package.json", '{"dependencies":{"prisma":"^6.0.0"}}'),
    ], existing);

    expect(signals.map((s) => s.id)).not.toContain("made-up");
  });
});
