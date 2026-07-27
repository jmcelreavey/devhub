/**
 * One-shot: stamp curated frontmatter onto every doc.
 *
 * Titles and descriptions are hand-written rather than derived, because the
 * derived versions read like the first sentence of a file — which is what they
 * were. Ordering is explicit so sections read as a sequence, not alphabetically.
 *
 * Safe to re-run: it replaces the frontmatter block and leaves the body alone.
 *
 * Usage: npx tsx scripts/apply-docs-frontmatter.ts [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../lib/docs/frontmatter";
import type { DocFrontmatter } from "../lib/docs/frontmatter";

const DOCS_ROOT = path.resolve(__dirname, "../../docs");

const META: Record<string, DocFrontmatter> = {
  "README": {
    title: "DevHub Documentation",
    description:
      "A local-first workspace for AI coding tools, notes, tasks, and shared agent configuration. Start here.",
    icon: "BookOpen",
    order: 0,
    tags: ["overview"],
    related: ["getting-started/installation", "architecture/overview"],
  },

  /* ------------------------------------------------------- getting started */
  "getting-started/installation": {
    title: "Installation",
    description:
      "Get DevHub running locally: prerequisites, Safe-Chain, install, and first launch.",
    icon: "Download",
    order: 1,
    tags: ["setup"],
    related: ["getting-started/setup", "reference/platform-support"],
  },
  "getting-started/setup": {
    title: "Setup",
    description:
      "Configure paths, ports, and optional integrations from the /setup page instead of hand-editing env files.",
    icon: "Settings",
    order: 2,
    tags: ["setup"],
    related: ["reference/environment-variables", "getting-started/installation"],
  },
  "getting-started/desktop-app": {
    title: "The desktop app",
    description:
      "Install and run DevHub as a native macOS app — no terminal, no checkout required.",
    icon: "Monitor",
    order: 3,
    tags: ["setup", "desktop"],
    related: ["architecture/desktop-shell", "guides/desktop-recovery"],
  },
  "getting-started/migrating": {
    title: "Migrating an older setup",
    description: "Move an existing DevHub install onto the current directory layout.",
    icon: "ArrowRightLeft",
    order: 4,
    tags: ["setup"],
    related: ["getting-started/installation"],
  },

  /* --------------------------------------------------------- architecture */
  "architecture/overview": {
    title: "Architecture Overview",
    description:
      "The five moving parts of DevHub, how data flows between them, and the local-first constraints that shape everything else.",
    icon: "Compass",
    order: 1,
    tags: ["architecture"],
    related: [
      "architecture/dashboard",
      "architecture/sync-engine",
      "architecture/mcp-server",
    ],
  },
  "architecture/dashboard": {
    title: "Dashboard",
    description:
      "The Next.js app you use day to day: routes, data loading, storage boundaries, and where features hook in.",
    icon: "LayoutDashboard",
    order: 2,
    tags: ["architecture", "dashboard"],
    related: ["reference/api-routes", "architecture/notes-system"],
  },
  "architecture/notes-system": {
    title: "Notes and vaults",
    description:
      "File-backed notes, docs, tasks and diagrams — the storage model shared by humans and AI tools.",
    icon: "NotebookPen",
    order: 3,
    tags: ["architecture", "notes"],
    related: ["architecture/memory", "guides/sharing"],
  },
  "architecture/sync-engine": {
    title: "Sync engine",
    description:
      "How shared skills, agents, persona and MCP config get copied into each tool's local directories.",
    icon: "RefreshCw",
    order: 4,
    tags: ["architecture", "sync"],
    related: ["guides/skills", "guides/agents", "architecture/plugins"],
  },
  "architecture/mcp-server": {
    title: "MCP server",
    description:
      "The local `devhub` Model Context Protocol server that exposes notes, tasks and dashboard workflows to AI tools.",
    icon: "Server",
    order: 5,
    tags: ["architecture", "mcp"],
    related: ["architecture/dashboard", "guides/appraisal"],
  },
  "architecture/plugins": {
    title: "Plugin system",
    description:
      "Tier-1 to tier-3 plugins: how a separate repo contributes skills, agents, MCP servers and dashboard modules.",
    icon: "Blocks",
    order: 6,
    tags: ["architecture", "plugins"],
    related: ["guides/creating-plugins", "guides/theming"],
  },
  "architecture/persona-system": {
    title: "Persona system",
    description:
      "Layered instruction files that keep assistant behaviour consistent across every tool.",
    icon: "UserRound",
    order: 7,
    tags: ["architecture", "persona"],
    related: ["architecture/token-budget", "guides/skills"],
  },
  "architecture/desktop-shell": {
    title: "Desktop shell",
    description:
      "The Tauri 2 wrapper: window lifecycle, the bundled Node server, and the updater.",
    icon: "AppWindow",
    order: 8,
    tags: ["architecture", "desktop"],
    related: ["guides/desktop-development", "getting-started/desktop-app"],
  },
  "architecture/memory": {
    title: "Memory architecture",
    description:
      "Why DevHub stores memory as git-backed local files, and what the alternatives cost.",
    icon: "Database",
    order: 9,
    tags: ["architecture", "notes"],
    related: ["architecture/notes-system", "architecture/token-budget"],
  },
  "architecture/token-budget": {
    title: "Token budget",
    description:
      "Splitting always-loaded guidance from on-demand knowledge so context stays useful.",
    icon: "Gauge",
    order: 10,
    tags: ["architecture", "persona"],
    related: ["architecture/persona-system", "guides/skills"],
  },

  /* ---------------------------------------------------------------- guides */
  "guides/command-palette": {
    title: "Command palette",
    description: "The fastest way to move around DevHub and trigger common actions.",
    icon: "Command",
    order: 1,
    tags: ["ui"],
    related: ["guides/theming"],
  },
  "guides/skills": {
    title: "Skills",
    description:
      "Reusable agent instructions: authoring them, syncing them, and where each tool picks them up.",
    icon: "Sparkles",
    order: 2,
    tags: ["agents"],
    related: ["guides/agents", "architecture/sync-engine"],
  },
  "guides/agents": {
    title: "Shared agents",
    description:
      "Subagent personas synced from `agents/shared/` into Cursor, Codex, OpenCode and friends.",
    icon: "Bot",
    order: 3,
    tags: ["agents"],
    related: ["guides/skills", "architecture/persona-system"],
  },
  "guides/repo-learning": {
    title: "Repo learning",
    description:
      "Get oriented in an unfamiliar checkout using deterministic repo facts plus optional AI summaries.",
    icon: "GitBranch",
    order: 4,
    tags: ["workflow"],
    related: ["integrations/github"],
  },
  "guides/standup": {
    title: "Standup",
    description: "Generate a Markdown standup from local git, Jira and calendar signals.",
    icon: "Users",
    order: 5,
    tags: ["workflow"],
    related: ["integrations/jira", "integrations/github"],
  },
  "guides/appraisal": {
    title: "Performance appraisal",
    description:
      "Capture review evidence through MCP tools and render it as notes in the dashboard.",
    icon: "Award",
    order: 6,
    tags: ["workflow"],
    related: ["architecture/mcp-server"],
  },
  "guides/scheduled-jobs": {
    title: "Scheduled jobs",
    description: "Run maintenance actions on a cron-like schedule while the dashboard is up.",
    icon: "Clock",
    order: 7,
    tags: ["workflow"],
    related: ["reference/scripts"],
  },
  "guides/sharing": {
    title: "Sharing notes and docs",
    description:
      "Publish a note or doc as a secret Gist — a read-only link you can paste anywhere.",
    icon: "Share2",
    order: 8,
    tags: ["workflow"],
    related: ["architecture/notes-system", "integrations/github"],
  },
  "guides/theming": {
    title: "Theming",
    description:
      "Theme modes, accent presets, plugin whitelabelling, and how the palette is applied on first paint.",
    icon: "Palette",
    order: 9,
    tags: ["ui"],
    related: ["guides/motion", "architecture/plugins"],
  },
  "guides/motion": {
    title: "Motion and loading states",
    description:
      "The motion policy: shimmer for arriving content, spin only for user-triggered actions, and the reduced-motion kill switch.",
    icon: "Zap",
    order: 10,
    tags: ["ui"],
    related: ["guides/theming"],
  },
  "guides/pwa": {
    title: "Install as a PWA",
    description: "Install the dashboard as a Progressive Web App from a supported browser.",
    icon: "Smartphone",
    order: 11,
    tags: ["ui"],
    related: ["getting-started/desktop-app"],
  },
  "guides/creating-plugins": {
    title: "Creating a plugin",
    description:
      "Build a plugin repo from scratch: manifest, assets, dashboard modules, and registration.",
    icon: "PackagePlus",
    order: 12,
    tags: ["plugins"],
    related: ["architecture/plugins", "guides/fork-workflow"],
  },
  "guides/fork-workflow": {
    title: "Fork workflow",
    description:
      "Working as a private mirror of the shared public core: pulling in, pushing back, and the personal-data boundary.",
    icon: "GitFork",
    order: 13,
    tags: ["contributing"],
    related: ["guides/creating-plugins"],
  },
  "guides/desktop-development": {
    title: "Working on the desktop app",
    description: "Everything under `desktop/`: staging, building, signing, and local installs.",
    icon: "Hammer",
    order: 14,
    tags: ["desktop"],
    related: ["architecture/desktop-shell", "guides/desktop-recovery"],
  },
  "guides/desktop-recovery": {
    title: "Desktop recovery",
    description:
      "When the desktop app will not start: a triage order, and how to prove each fix worked.",
    icon: "LifeBuoy",
    order: 15,
    tags: ["desktop", "troubleshooting"],
    related: ["guides/desktop-development", "getting-started/desktop-app"],
  },
  "guides/opencode-and-chamber": {
    title: "OpenCode and OpenChamber",
    description:
      "The four cooperating local services started by `npm run dev`, and how to run them apart.",
    icon: "Terminal",
    order: 16,
    tags: ["workflow"],
    related: ["reference/scripts", "reference/environment-variables"],
  },

  /* ---------------------------------------------------------- integrations */
  "integrations/github": {
    title: "GitHub",
    description: "PR tracking, repo awareness, and standup input via the local `gh` session.",
    icon: "GitPullRequest",
    order: 1,
    tags: ["integrations"],
    related: ["guides/standup", "guides/repo-learning"],
  },
  "integrations/jira": {
    title: "Jira",
    description: "Bring assigned tickets into DevHub and improve standup generation.",
    icon: "SquareKanban",
    order: 2,
    tags: ["integrations"],
    related: ["guides/standup"],
  },
  "integrations/google-calendar": {
    title: "Google Calendar",
    description: "Upcoming events in the Today view and the morning briefing.",
    icon: "Calendar",
    order: 3,
    tags: ["integrations"],
    related: ["guides/standup"],
  },
  "integrations/datadog": {
    title: "Datadog",
    description: "Alert views, on-call status, recent events, and AI investigation handoffs.",
    icon: "Activity",
    order: 4,
    tags: ["integrations"],
    related: ["reference/environment-variables"],
  },
  "integrations/figma": {
    title: "Figma",
    description:
      "Give AI agents access to design files, components, frames and design-system context.",
    icon: "PenTool",
    order: 5,
    tags: ["integrations"],
    related: ["architecture/mcp-server"],
  },

  /* ------------------------------------------------------------- reference */
  "reference/api-routes": {
    title: "API routes",
    description:
      "Local dashboard endpoints, their auth posture, and the notable user-facing ones.",
    icon: "Route",
    order: 1,
    tags: ["reference"],
    related: ["architecture/dashboard", "reference/environment-variables"],
  },
  "reference/environment-variables": {
    title: "Environment variables",
    description: "Every variable DevHub reads: paths, ports, integrations and secrets.",
    icon: "KeyRound",
    order: 2,
    tags: ["reference"],
    related: ["getting-started/setup", "reference/scripts"],
  },
  "reference/scripts": {
    title: "Scripts",
    description: "Root convenience scripts and dashboard lifecycle scripts, and what each one does.",
    icon: "SquareTerminal",
    order: 3,
    tags: ["reference"],
    related: ["guides/opencode-and-chamber"],
  },
  "reference/platform-support": {
    title: "Platform support",
    description: "Which platforms run DevHub fully, partially, or read-only.",
    icon: "MonitorSmartphone",
    order: 4,
    tags: ["reference"],
    related: ["getting-started/installation"],
  },
  "reference/backlog": {
    title: "Quality backlog",
    description: "The standing DRY/DX themes tracked across the codebase.",
    icon: "ListTodo",
    order: 5,
    tags: ["reference"],
  },

  /* --------------------------------------------------------------- archive */
  "archive/README": {
    title: "Archive",
    description: "Plans for work that has since shipped, plus point-in-time audits.",
    icon: "Archive",
    order: 0,
    tags: ["archive"],
  },
  "archive/tauri-desktop-plan": {
    title: "Tauri desktop migration plan",
    description: "Completed 2026-07-26. The phased plan that replaced Electron with Tauri 2.",
    icon: "Archive",
    order: 1,
    tags: ["archive", "desktop"],
    related: ["architecture/desktop-shell"],
  },
  "archive/capability-radar-plan": {
    title: "Capability radar plan",
    description: "Phases 0–4 built and verified; a few stretch items remain.",
    icon: "Archive",
    order: 2,
    tags: ["archive"],
  },
  "archive/devhub-mcp-split-plan": {
    title: "MCP server split plan",
    description: "Splitting the single notes-server into DevHub MCP core plus a notes server.",
    icon: "Archive",
    order: 3,
    tags: ["archive", "mcp"],
    related: ["architecture/mcp-server"],
  },
  "archive/self-appraisal-mcp-plan": {
    title: "Self-appraisal MCP plan",
    description: "Implemented. The design behind the appraisal tools on the devhub server.",
    icon: "Archive",
    order: 4,
    tags: ["archive"],
    related: ["guides/appraisal"],
  },
  "archive/mobile-audit-2026-06-15": {
    title: "Mobile audit (June 2026)",
    description: "A point-in-time walk of every screen at 500px and 375px widths.",
    icon: "Archive",
    order: 5,
    tags: ["archive", "ui"],
  },
};

function walk(dir: string, prefix = ""): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(dir, entry.name), rel);
      return entry.name.endsWith(".md") ? [rel.replace(/\.md$/, "")] : [];
    });
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const slugs = walk(DOCS_ROOT).sort();
  const missing = slugs.filter((slug) => !META[slug]);
  const stale = Object.keys(META).filter((slug) => !slugs.includes(slug));

  if (missing.length > 0) console.error("No metadata for:", missing.join(", "));
  if (stale.length > 0) console.error("Metadata for missing docs:", stale.join(", "));
  if (checkOnly) {
    process.exit(missing.length + stale.length > 0 ? 1 : 0);
  }

  let written = 0;
  for (const slug of slugs) {
    const meta = META[slug];
    if (!meta) continue;
    const file = path.join(DOCS_ROOT, `${slug}.md`);
    const source = fs.readFileSync(file, "utf8");
    const { body } = parseFrontmatter(source);
    const next = `${serializeFrontmatter(meta)}\n${body.replace(/\s*$/, "")}\n`;
    if (next !== source) {
      fs.writeFileSync(file, next);
      written += 1;
    }
  }
  console.log(`frontmatter written: ${written}/${slugs.length}`);
}

main();
