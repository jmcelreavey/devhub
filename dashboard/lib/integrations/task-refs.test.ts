import { expect, it } from "vitest";
import { taskRefs } from "./task-refs";
import type { Task } from "@shared/tasks/types.ts";
it("keeps legacy links and account-qualified refs without mutating saved tasks", () => {
  const task = { jiraKey: "APP-1", integrationRefs: [{ provider: "jira", account: "other", kind: "issue", id: "APP-1" }], links: [{ kind: "url", id: "pr", href: "https://github.com/org/repo/pull/2", label: "PR" }] } as unknown as Task;
  const refs = taskRefs(task);
  expect(refs).toHaveLength(3); expect(task.integrationRefs).toHaveLength(1);
  expect(refs.filter((r) => r.provider === "jira").map((r) => r.account)).toEqual(["other", "default"]);
  expect(refs.find((r) => r.kind === "pr")?.id).toBe("org/repo/2");
});
