import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { execExternal } from "../../../apps/core/src/lib/exec-external";
import { zshStartupFiles } from "./zsh-startup";

it.skipIf(!fs.existsSync("/bin/zsh"))("loads user login files and prompt config with their real ZDOTDIR", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-zsh-"));
  try {
    const user = path.join(root, "user config");
    const bridge = path.join(root, "bridge");
    fs.mkdirSync(user);
    fs.mkdirSync(bridge);
    for (const [file, content] of Object.entries(zshStartupFiles())) fs.writeFileSync(path.join(bridge, file), content);
    fs.writeFileSync(path.join(root, "hooks.zsh"), 'print -r -- "hooks"\n');
    for (const file of [".zshenv", ".zprofile", ".zshrc", ".zlogin"]) {
      fs.writeFileSync(path.join(user, file), `print -r -- "${file}:$ZDOTDIR"\n`);
    }
    fs.appendFileSync(path.join(user, ".zshrc"), 'PROMPT="my prompt"\n');
    const { stdout } = await execExternal("/bin/zsh", ["-lic", 'print -r -- "prompt:$PROMPT"'], {
      env: { PATH: "/usr/bin:/bin", HOME: user, ZDOTDIR: bridge, USER_ZDOTDIR: user, DEVHUB_USER_ZDOTDIR_SET: "1" }, timeoutMs: 5000,
    });
    expect(stdout.trim().split("\n")).toEqual([`.zshenv:${user}`, `.zprofile:${user}`, `.zshrc:${user}`, "hooks", `.zlogin:${user}`, "prompt:my prompt"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
