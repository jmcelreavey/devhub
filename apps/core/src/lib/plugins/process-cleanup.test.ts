import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { execExternal, isExecAbort } from "../exec-external";
import { cleanScratch, scratchDir } from "./test-fixtures";

afterEach(cleanScratch);

it.each([0, 50])("waits for a cancelled process to exit before staging cleanup (PID write delayed %i ms)", async (pidWriteDelay) => {
  const pidFile = path.join(scratchDir(), "pid");
  const controller = new AbortController();
  const pending = execExternal(process.execPath, ["--eval", `const fs = require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)}, '');setTimeout(() => fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)), ${pidWriteDelay});setInterval(()=>{},1000);`], { signal: controller.signal, timeoutMs: 5000 }).catch((err: unknown) => err);
  const deadline = Date.now() + 4000;
  let pid = 0;
  try {
    // File creation precedes its contents; an empty read becomes PID 0 (our own process group).
    while (Date.now() < deadline) {
      if (fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, "utf8"));
      if (Number.isInteger(pid) && pid > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(pid).toBeGreaterThan(0);
    controller.abort();
    expect(isExecAbort(await pending)).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    controller.abort();
    await pending;
  }
});
