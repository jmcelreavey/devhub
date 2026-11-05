import { describe, expect, it } from "vitest";
import { resolveWorkTab, validWorkDate } from "./work-target";

describe("Work deep links", () => {
  it("opens legacy date links in history, including explicit tasks links", () => {
    expect(resolveWorkTab(new URLSearchParams("date=2026-10-20"), "tasks")).toBe("history");
    expect(resolveWorkTab(new URLSearchParams("date=2026-10-20&tab=tasks"), "tasks")).toBe("history");
  });

  it("opens ticket links in Jira without replacing explicit views", () => {
    expect(resolveWorkTab(new URLSearchParams("ticket=ABC-123"), "tasks")).toBe("jira");
    expect(resolveWorkTab(new URLSearchParams("ticket=ABC-123&tab=board"), "tasks")).toBe("board");
    expect(resolveWorkTab(new URLSearchParams("tab=tickets"), "tasks")).toBe("jira");
    expect(resolveWorkTab(new URLSearchParams("tab=reviews"), "tasks")).toBe("reviews");
  });

  it("checks that date targets are real calendar days", () => {
    expect(validWorkDate("2024-02-29")).toBe(true);
    expect(validWorkDate("2026-02-29")).toBe(false);
    expect(validWorkDate("2026-02-30")).toBe(false);
    expect(validWorkDate("2026-2-01")).toBe(false);
    expect(validWorkDate("")).toBe(false);
  });
});
