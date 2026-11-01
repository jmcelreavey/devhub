import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitMutationRoot } from "./command";

describe("Git command queue selection", () => {
  const root = path.resolve("fixture");
  it("keeps reads independent while resolving global directory and config options", () => {
    expect(gitMutationRoot(["-C", "nested", "--literal-pathspecs", "status", "--porcelain"], root, {})).toBeNull();
    expect(gitMutationRoot(["-C", "nested", "-C", "..", "-c", "credential.helper=", "add", "--", "file"], root, {})).toBe(root);
    expect(gitMutationRoot(["--git-dir=.git", "update-ref", "refs/test", "HEAD"], root, {})).toBe(path.join(root, ".git"));
    expect(gitMutationRoot(["clone", "--", "source", "destination"], root, {})).toBe(path.join(root, "destination"));
  });
  it("queues mutations even when a read-looking option or alias is present", () => {
    expect(gitMutationRoot(["branch", "--list", "--delete", "topic"], root, {})).toBe(root);
    expect(gitMutationRoot(["-c", "alias.save=commit", "save"], root, {})).toBe(root);
    expect(gitMutationRoot(["config", "user.name", "New Name"], root, {})).toBe(root);
    expect(gitMutationRoot(["config", "user.name"], root, {})).toBeNull();
    expect(gitMutationRoot(["config", "edit"], root, {})).toBe(root);
    expect(gitMutationRoot(["remote", "-v", "add", "origin", "source"], root, {})).toBe(root);
    expect(gitMutationRoot(["branch", "-l", "topic"], root, {})).toBe(root);
    expect(gitMutationRoot(["branch", "-a", "-u", "origin/main"], root, {})).toBe(root);
  });
});
