# DevHub Selection

Send a saved or unsaved code selection to DevHub's preview, then choose a task, assistant and conversation there. Sending from the editor does not start an assistant.

Build with `npm ci && npm run build`. Install the folder in a VS Code-compatible extension development host, or package it with `vsce package` and install the resulting VSIX. For code-server use Open VSX or publisher-authorised extensions; this add-on does not use Microsoft's Marketplace.

Open the same workspace in DevHub and your editor. In DevHub → Editor, create a pairing code. Run **DevHub: Pair this Workspace**, paste the code, then select code and run **DevHub: Ask AI about Selection**. The code expires after 30 minutes and is kept in the editor's SecretStorage. DevHub can revoke it immediately. Pending selections expire after 10 minutes and disappear when DevHub stops.

For WSL, install this extension in the workspace's WSL extension host. Pairing checks the real workspace path; Windows paths are not translated. Cursor uses the same extension API, but its WSL host needs separate testing.

The selected text, line ranges, document version and unsaved flag are previewed exactly. Credential filenames, traversal and symlink escapes are blocked by DevHub. File naming rules cannot detect every secret inside ordinary source files; inspect the preview before sending.
