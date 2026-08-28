import { describe, expect, it, vi } from "vitest";

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
