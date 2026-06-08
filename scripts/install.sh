#!/usr/bin/env bash
# install.sh — Bootstrap a new machine: git hooks, dashboard deps, then TypeScript orchestration.
#
# Usage: bash scripts/install.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "[install] $*"; }
warn() { echo "[install] WARNING: $*" >&2; }

echo "=== DevHub Installation ==="
echo ""

# --- 1. Wire git hooks (pre-push runs dashboard verify) ---
if [[ -d "$REPO_ROOT/.githooks" ]] && command -v git &>/dev/null; then
    chmod +x "$REPO_ROOT"/.githooks/* 2>/dev/null || true
    (cd "$REPO_ROOT" && git config core.hooksPath .githooks 2>/dev/null) || true
    log "Git hooks enabled (pre-push runs dashboard verify)."
fi

# --- 2. Install dashboard dependencies (includes OpenChamber via devDependency + start script) ---
DASHBOARD_DIR="$REPO_ROOT/dashboard"
if ! command -v npm &>/dev/null; then
    warn "npm not found — install Node.js (>=20) before continuing."
    exit 1
fi
if [[ ! -f "$DASHBOARD_DIR/package.json" ]]; then
    warn "dashboard/package.json missing — bad checkout?"
    exit 1
fi

if ! command -v safe-chain &>/dev/null; then
    warn "safe-chain not installed."
    echo "  Install: npm install -g @aikidosec/safe-chain@1.1.10" >&2
    echo "  Then run: safe-chain setup" >&2
    echo "  Restart your terminal, then re-run: bash scripts/install.sh" >&2
    echo "  See README.md (Safe-Chain) for details." >&2
    exit 1
fi

log "Installing dashboard dependencies..."
npm ci --prefix "$DASHBOARD_DIR" --silent 2>/dev/null || {
    warn "npm ci failed — falling back to npm install"
    npm install --prefix "$DASHBOARD_DIR" --silent || {
        warn "Dependency install failed — run manually: npm install (repo root) or cd dashboard && npm install"
        exit 1
    }
}

# --- 3. Everything else: sync, MCP, notes-server, build, validate (TypeScript) ---
log "Running bootstrap (TypeScript)..."
(cd "$DASHBOARD_DIR" && npx --no-install tsx scripts/bootstrap-install.ts) || {
    warn "Bootstrap had issues — see output above"
}

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Dashboard:"
echo "  Dev (hot reload): npm run dev   (repo root) or cd dashboard && npm run dev"
echo "  Production:       npm run start (repo root) or cd dashboard && npm run start"
echo "  Open:             http://localhost:1337"
echo ""
echo "Next steps:"
echo "  1. Open http://localhost:1337/setup to configure optional integrations"
echo "  2. Start an AI session and verify skills are loaded"
echo "  3. Use 'session-notes' skill after your first significant task"
echo "  4. Run 'optimize' skill weekly to self-improve based on learnings"
