import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { suggestWorkItemTitles } from "@/lib/notes/work-item-titles";

vi.mock("@/lib/notes/work-item-titles", () => ({
  suggestWorkItemTitles: vi.fn(),
  WORK_ITEM_TITLES_TIMEOUT_MS: 180_000,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

vi.mock("@/lib/jira/client", () => ({
  getJiraMeta: vi.fn(async () => ({ configured: false })),
}));

vi.mock("@/lib/entity-links/resolve", () => ({
  resolveEntityContext: vi.fn(() => ({ related: [] })),
}));

vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({
    read: (notePath: string) => {
      if (notePath !== "projects/sample-plan") return null;
      return {
        content: [
          {
            type: "heading",
            props: { level: 1 },
            content: [{ type: "text", text: "Sample plan", styles: {} }],
          },
          {
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "PR 1 — WebApp: signup events", styles: {} }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Track page views.", styles: {} }],
          },
        ],
      };
    },
  })),
}));

describe("POST /api/notes/create-tasks/plan", () => {
  function request(body: unknown, origin = "http://localhost") {
    return new NextRequest("http://localhost/api/notes/create-tasks/plan", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", origin },
      body: JSON.stringify(body),
    });
  }

  it("returns generated titles with source descriptions", async () => {
    vi.mocked(suggestWorkItemTitles).mockImplementation(async (_title, items) =>
      items.map((item) => ({ ...item, summary: "Track signup page views" })),
    );
    const { POST } = await import("./route");
    const res = await POST(request({ notePath: "projects/sample-plan" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workItems[0]).toMatchObject({
      id: "pr-1", summary: "Track signup page views", description: "Track page views.",
    });
    expect(body.warning).toBeUndefined();
  });

  it.each([
    { duration: 65_000, refined: true },
    { duration: 181_000, refined: false },
  ])("handles a $duration ms generation without confusing detection with refinement", async ({ duration, refined }) => {
    const { POST } = await import("./route");
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Native AbortSignal timers do not use Vitest's clock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), delay);
      return controller.signal;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    vi.mocked(suggestWorkItemTitles).mockImplementation((_title, items, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(items.map((item) => ({
          ...item, summary: "Track signup page views",
        }))), duration);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
        markStarted();
      }),
    );

    const response = POST(request({ notePath: "projects/sample-plan" }));
    await started;
    await vi.advanceTimersByTimeAsync(duration);
    const body = await (await response).json();
    if (refined) {
      expect(body.workItems[0].summary).toBe("Track signup page views");
      expect(body.warning).toBeUndefined();
    } else {
      expect(body.workItems[0].summary).toContain("signup events");
      expect(body.warning).toContain("Work items detected");
      expect(body.warning).toContain("AI title refinement timed out");
      expect(body.warning).toContain("titles taken from the note");
    }
  });

  it("keeps editable original titles when generation fails", async () => {
    vi.mocked(suggestWorkItemTitles).mockRejectedValue(new Error("Unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("./route");
    const res = await POST(request({ notePath: "projects/sample-plan" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workItems[0].summary).toContain("signup events");
    expect(body.warning).toContain("Work items detected");
    expect(body.warning).toContain("AI title refinement failed");
    expect(body.warning).toContain("titles taken from the note");
  });

  it("validates the request and missing notes before generating titles", async () => {
    const { POST } = await import("./route");
    expect((await POST(request({ notePath: "" }))).status).toBe(400);
    expect((await POST(request({ notePath: "missing" }))).status).toBe(404);
    expect(suggestWorkItemTitles).not.toHaveBeenCalled();
  });

  it("rejects cross-origin generation requests", async () => {
    const { POST } = await import("./route");
    expect((await POST(request({ notePath: "projects/sample-plan" }, "https://elsewhere.example"))).status).toBe(403);
    expect(suggestWorkItemTitles).not.toHaveBeenCalled();
  });
});

describe("GET /api/notes/create-tasks/plan", () => {
  it("returns parsed work items for a plan note", async () => {
    const { GET } = await import("@/app/api/notes/create-tasks/plan/route");
    const req = {
      nextUrl: new URL(
        "http://localhost/api/notes/create-tasks/plan?notePath=projects/sample-plan&parentKey=PTF-4484",
      ),
    } as import("next/server").NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      workItems: { id: string }[];
      parentKey: string | null;
      projectKey: string;
    };
    expect(body.title).toBe("Sample plan");
    expect(body.workItems).toHaveLength(1);
    expect(body.workItems[0]?.id).toBe("pr-1");
    expect(body.parentKey).toBe("PTF-4484");
    expect(body.projectKey).toBe("PTF");
  });

  it("rejects missing notePath", async () => {
    const { GET } = await import("@/app/api/notes/create-tasks/plan/route");
    const req = {
      nextUrl: new URL("http://localhost/api/notes/create-tasks/plan"),
    } as import("next/server").NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
