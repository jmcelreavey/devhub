#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "../dashboard/node_modules/esbuild/lib/main.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function buildEditorExtension() {
  buildSync({ entryPoints: [path.join(root, "extensions/devhub-selection/src/extension.ts")], outfile: path.join(root, "extensions/devhub-selection/dist/extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"] });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildEditorExtension();
