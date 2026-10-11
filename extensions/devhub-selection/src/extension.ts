import * as vscode from "vscode";
import { createHash } from "node:crypto";
import fs from "node:fs";
interface Pairing { origin: string; workspaceId: string; root: string; token: string }
function parsePairing(raw: string): Pairing {
  if (raw.length > 4000) throw new Error("Invalid pairing code.");
  const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Pairing>;
  if (typeof value.origin !== "string" || typeof value.workspaceId !== "string" || typeof value.root !== "string" || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error("Invalid pairing code.");
  const url = new URL(value.origin);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== value.origin) throw new Error("Pair only with DevHub on this computer.");
  return value as Pairing;
}
export function activate(context: vscode.ExtensionContext) {
  function folder() {
    const editor = vscode.window.activeTextEditor;
    const selected = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const workspace = selected ?? (vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0] : undefined);
    if (!workspace || workspace.uri.scheme !== "file") throw new Error("Open the local workspace you paired in DevHub.");
    return workspace;
  }
  const guarded = (action: () => Promise<void>) => async () => {
    try { await action(); } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "DevHub could not receive the selection."); }
  };
  context.subscriptions.push(vscode.commands.registerCommand("devhub.pair", guarded(async () => {
    const workspace = folder();
    const code = await vscode.window.showInputBox({ title: "Pair this workspace with DevHub", prompt: "Paste the 30-minute pairing code from DevHub → Editor.", password: true, ignoreFocusOut: true });
    if (!code) return;
    const pairing = parsePairing(code.trim());
    if (fs.realpathSync(workspace.uri.fsPath) !== fs.realpathSync(pairing.root)) throw new Error("This pairing belongs to a different workspace. In WSL, install the add-on in the WSL extension host.");
    await context.secrets.store("pair:" + workspace.uri.fsPath, code.trim());
    void vscode.window.showInformationMessage("Paired. Selections open a preview in DevHub; nothing is sent to an AI automatically.");
  })));
  context.subscriptions.push(vscode.commands.registerCommand("devhub.forgetPairing", guarded(async () => {
    await context.secrets.delete("pair:" + folder().uri.fsPath);
    void vscode.window.showInformationMessage("Pairing removed from this editor. Revoke it in DevHub to invalidate other copies.");
  })));
  context.subscriptions.push(vscode.commands.registerCommand("devhub.askSelection", guarded(async () => {
    const workspace = folder();
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file" || editor.selections.every((selection) => selection.isEmpty)) throw new Error("Select code in a file first.");
    const code = await context.secrets.get("pair:" + workspace.uri.fsPath);
    if (!code) throw new Error("Run DevHub: Pair this Workspace first.");
    const pairing = parsePairing(code);
    const selectedText = editor.selections.filter((selection) => !selection.isEmpty).map((selection) => editor.document.getText(selection)).join("\n");
    if (selectedText.length > 12000) throw new Error("Select at most 12,000 characters.");
    const ranges = editor.selections.filter((selection) => !selection.isEmpty).map((selection) => `${selection.start.line + 1}:${selection.start.character + 1}–${selection.end.line + 1}:${selection.end.character + 1}`).join(", ");
    if (ranges.length > 200) throw new Error("Select fewer separate ranges.");
    const response = await fetch(pairing.origin + "/api/editor/incoming", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + pairing.token },
      body: JSON.stringify({ workspaceId: pairing.workspaceId, relativePath: vscode.workspace.asRelativePath(editor.document.uri, false).replaceAll("\\", "/"),
        revision: createHash("sha256").update(editor.document.getText()).digest("hex"), ranges, selectedText,
        documentVersion: editor.document.version, dirty: editor.document.isDirty, source: "editor" }),
    });
    const data = await response.json() as { id?: string; error?: string };
    if (!response.ok || !data.id || !/^[0-9a-f-]{36}$/.test(data.id)) throw new Error(data.error || "DevHub did not accept the selection.");
    if (vscode.env.uiKind === vscode.UIKind.Web) {
      // code-server rewrites localhost links through its port proxy. The open
      // DevHub editor receives this preview from its authenticated inbox instead.
      void vscode.window.showInformationMessage("Selection ready in the open DevHub editor. Review it before sending.");
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(pairing.origin + "/editor?selection=" + encodeURIComponent(data.id)));
  })));
}
