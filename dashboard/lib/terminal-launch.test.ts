import { afterEach, describe, expect, it } from "vitest";
import { opencodeReviewCommand } from "./terminal-launch";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("opencodeReviewCommand", () => {
  it("runs the pr-explain-review skill against the PR url", () => {
    const command = opencodeReviewCommand("https://github.com/acme/app/pull/1");
    expect(command).toContain("opencode run");
    expect(command).toContain("pr-explain-review");
    expect(command).toContain("https://github.com/acme/app/pull/1");
  });

  it("pins PR reviews to the DevHub repo notes directory and names the note path", () => {
    process.env.NEXT_PUBLIC_REPO_ROOT = "/repo/devhub";

    const command = opencodeReviewCommand("https://github.com/acme/app/pull/1", "pr-reviews/acme-app-1");

    expect(command).toContain("REPO_ROOT='/repo/devhub' NOTES_DIR='/repo/devhub/notes' opencode run");
    expect(command).toContain("Notes MCP path: pr-reviews/acme-app-1");
    expect(command).toContain("notes_write");
  });

  it("omits the note instruction when no path is given", () => {
    const command = opencodeReviewCommand("https://github.com/acme/app/pull/1");
    expect(command).not.toContain("notes_write");
  });
});
