import { expect, it } from "vitest";
import { statusLogs } from "./status.ts";

it("bounds the log scan before filtering and preserves case-insensitive tail selection", async () => {
  const calls: unknown[] = [];
  const result = await statusLogs.handler(statusLogs.input.parse({ filter: " ERROR ", lines: 1 }), {
    read: (input) => {
      calls.push(input);
      return { logDir: "/fixture/logs", lines: [{ raw: "ERROR old" }, { raw: "normal" }, { raw: "error recent" }] };
    },
  });
  expect(calls).toEqual([{ source: "all", lines: 1000 }]);
  expect(result.data.lines).toEqual([{ raw: "error recent" }]);
  for (const input of [{ lines: 0 }, { lines: 1001 }, { source: "../secret" }, { filter: " " }]) {
    expect(statusLogs.input.safeParse(input).success).toBe(false);
  }
});
