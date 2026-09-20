#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_PICKERS = [
  "packages/desktop/src/renderer/components/workspace/WorkspaceFolderSelect.tsx",
  "packages/desktop/src/renderer/hooks/file/useWorkspaceSelector.ts",
  "packages/desktop/src/renderer/pages/conversation/explorer/ExplorerContainer.tsx",
];

const PICKER_CALL = "ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] })";

export function defaultAionProjectDirectory() {
  const configured = process.env.DEVHUB_AIONUI_PROJECTS_DIR?.trim();
  const candidate = configured || path.join(os.homedir(), "Developer");
  if (!path.isAbsolute(candidate)) throw new Error("DEVHUB_AIONUI_PROJECTS_DIR must be an absolute path.");
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    if (configured) throw new Error(`DEVHUB_AIONUI_PROJECTS_DIR does not exist: ${candidate}`);
  }
  return os.homedir();
}

export function applyAionSourcePatches(releaseDir, defaultProjectDir = defaultAionProjectDirectory()) {
  const replacement = `ipcBridge.dialog.showOpen.invoke({ defaultPath: ${JSON.stringify(defaultProjectDir)}, properties: ['openDirectory', 'createDirectory'] })`;
  const patched = [];

  for (const relativePath of WORKSPACE_PICKERS) {
    const file = path.join(releaseDir, relativePath);
    if (!fs.existsSync(file)) throw new Error(`AionUi workspace picker is missing: ${relativePath}`);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(replacement)) continue;
    if (!source.includes(PICKER_CALL)) throw new Error(`AionUi workspace picker changed upstream: ${relativePath}`);
    fs.writeFileSync(file, source.replace(PICKER_CALL, replacement));
    patched.push(relativePath);
  }

  return { defaultProjectDir, patched };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const releaseDir = process.argv[2];
  if (!releaseDir) throw new Error("Pass the AionUi release directory.");
  const result = applyAionSourcePatches(releaseDir, process.argv[3] || defaultAionProjectDirectory());
  console.log(`Patched AionUi workspace pickers for ${result.defaultProjectDir}`);
}
