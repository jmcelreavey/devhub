import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { acknowledgeFailure, readFailureAcknowledgement } from "./failure-acknowledgements";
it("persists a reversible acknowledgement and refuses invalid task paths", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "failure-ack-"));
  try {
    expect(readFailureAcknowledgement("task", dir)).toBeUndefined();
    await acknowledgeFailure("task", "failure-key", dir);
    expect(readFailureAcknowledgement("task", dir)).toBe("failure-key");
    await acknowledgeFailure("task", null, dir);
    expect(readFailureAcknowledgement("task", dir)).toBeUndefined();
    await expect(acknowledgeFailure("../escape", "key", dir)).rejects.toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
