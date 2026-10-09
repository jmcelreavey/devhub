import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { execExternal, isExecAbort } from "../exec-external";
import { cleanScratch, scratchDir } from "./test-fixtures";

afterEach(cleanScratch);

it("waits for a cancelled process to exit before returning control to staging cleanup", async () => {
  const pidFile = path.join(scratchDir(), "pid");
  const controller = new AbortController();
  const pending = execExternal(process.execPath, ["--eval", `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(()=>{},1000);`], { signal: controller.signal, timeoutMs: 5000 }).catch((err: unknown) => err);
  const deadline = Date.now() + 4000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(pidFile)).toBe(true);
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  controller.abort();
  expect(isExecAbort(await pending)).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
});
