# README demo: one sync, every tool; one standard, everywhere; shared memory over MCP.
#
# Recorded against a disposable checkout and HOME built by scripts/demos/record.sh.
# Never run this tape directly — it runs a real sync and writes real notes.
#
# `devhub` below is a shell function wrapping dashboard/scripts/run-action.ts and
# mcp-servers/devhub-server/scripts/call-tool.mjs, so the visible commands stay short.
#
# Regenerate:  npm run demos:record
# Output:      docs/assets/demos/control-layer.gif

Output "../../docs/assets/demos/control-layer.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1480
Set Height 680
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type `test -e "$DEVHUB_DEMO_FIXTURE/.devhub-demo-fixture" || exit 1`
Enter
Type `export HOME="$DEVHUB_DEMO_FIXTURE/home" REPO_ROOT="$DEVHUB_DEMO_FIXTURE/devhub" NOTES_DIR="$DEVHUB_DEMO_FIXTURE/notes" DOCS_DIR="$DEVHUB_DEMO_FIXTURE/docs"`
Enter
Type `devhub() { if [ "$1" = mcp ]; then shift; node "$REPO_ROOT/mcp-servers/devhub-server/scripts/call-tool.mjs" "$@" 2>/dev/null; else (cd "$REPO_ROOT/dashboard" && ./node_modules/.bin/tsx scripts/run-action.ts "$@" 2>&1) | grep -E '^(Syncing|Done)' | sed -E 's/ \([^)]*\)//'; fi; }`
Enter
Type `cd "$REPO_ROOT" && export PS1='\[\e[1;35m\]devhub\[\e[0m\] $ ' && clear`
Enter
Show

Type "# Five AI coding tools. Each one starts with no idea how you work."
Enter
Sleep 1800ms

Type "devhub sync"
Enter
Sleep 5000ms

Type "# Skills, agents, MCP servers and standards: now in Claude Code, Codex, Cursor, OpenCode, Antigravity."
Enter
Sleep 3000ms

Type "clear"
Enter

Type "# Change one engineering standard, in one place..."
Enter
Sleep 1400ms

Type `echo "- Every bug fix ships with a regression test" >> persona/shared-persona.md`
Enter
Sleep 1200ms

Type "devhub sync"
Enter
Sleep 5000ms

Type "cd ~ && grep -l 'regression test' .claude/CLAUDE.md .codex/AGENTS.md .cursor/rules/*.mdc .gemini/GEMINI.md .opencode/AGENTS.md"
Enter
Sleep 3200ms

Type "# ...and every tool enforces it."
Enter
Sleep 2600ms

Type `cd "$REPO_ROOT" && clear`
Enter

Type "# Memory. An agent learns something the hard way and writes it down over the DevHub MCP server:"
Enter
Sleep 1600ms

Type `devhub mcp notes_write '{"path":"gotchas","content":"- npm 11 rewrites package-lock.json and CI on npm 10 rejects it. Pin Node 22."}'`
Enter
Sleep 2800ms

Type "# Days later, a different agent in a different tool hits the same wall:"
Enter
Sleep 1600ms

Type `devhub mcp notes_search '{"query":"package-lock"}'`
Enter
Sleep 3600ms

Type "# Same memory in every tool. Plain files, versioned in git."
Enter
Sleep 3500ms
