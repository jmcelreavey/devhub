import fs from "node:fs";
import path from "node:path";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Private launchers only. No shell profile changes and no writes into the signed app. */
export function prepareManagedTools({ node = process.execPath, dataDir, platform = process.platform }) {
  if (platform !== "darwin" && platform !== "linux") throw new Error("Agent tools run on macOS, Linux or inside WSL2.");
  const runtime = path.dirname(node);
  const npm = [path.join(runtime, "npm"), path.join(runtime, "lib", "node_modules", "npm")]
    .find((dir) => fs.existsSync(path.join(dir, "bin", "npm-cli.js")));
  if (!npm) throw new Error("Bundled tools are unavailable. Update or reinstall DevHub, then try again.");
  const bin = path.join(dataDir, "managed-node", "bin");
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const name of ["node", "npm", "npx"]) {
    const destination = path.join(bin, name);
    if (name === "node") {
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.rmSync(temporary, { force: true });
      fs.symlinkSync(node, temporary);
      fs.renameSync(temporary, destination);
    } else {
      const cli = path.join(npm, "bin", `${name}-cli.js`);
      if (!fs.existsSync(cli)) throw new Error(`Bundled ${name} is unavailable`);
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `#!/bin/sh\nexec ${quote(node)} ${quote(cli)} "$@"\n`, { mode: 0o700 });
      fs.renameSync(temporary, destination);
    }
  }
  return bin;
}
