import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_PACKAGES = Object.freeze({
  dashboard: ["apps/ui"],
  desktop: ["apps/desktop"],
  mcp: ["packages/mcp"],
});

export const BUILD_ENV_RELATIVE = "apps/core/src/lib/desktop/build-env.mjs";

export function resolveWorkspaceRoot(startDirectory) {
  let directory = path.resolve(startDirectory);
  for (;;) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
      if (manifest?.name === "devhub") return directory;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot find DevHub workspace root from ${startDirectory}`);
    directory = parent;
  }
}

export function resolveWorkspacePaths(root) {
  const dashboardDir = path.join(root, WORKSPACE_PACKAGES.dashboard[0]);
  return {
    dashboardDir,
    desktopDir: path.join(root, WORKSPACE_PACKAGES.desktop[0]),
    mcpDir: path.join(root, WORKSPACE_PACKAGES.mcp[0]),
    buildEnvFile: path.join(root, BUILD_ENV_RELATIVE),
    sharedActionsDir: path.join(root, "packages", "shared"),
  };
}
