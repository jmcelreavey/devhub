#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveWorkspacePaths, resolveWorkspaceRoot } from "./workspace-paths.mjs";

const root = resolveWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
const requireDashboard = createRequire(path.join(resolveWorkspacePaths(root).dashboardDir, "package.json"));
const { buildSync } = requireDashboard("esbuild");
export function buildEditorExtension() {
  buildSync({ entryPoints: [path.join(root, "extensions/devhub-selection/src/extension.ts")], outfile: path.join(root, "extensions/devhub-selection/dist/extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"] });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildEditorExtension();
