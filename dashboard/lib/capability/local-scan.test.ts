import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichSignalsWithAi } from "./ai-enrich";
import { readRepoScanCache, repoUnchanged } from "./snapshots";
import { scanLocalRepo } from "./local-scan";
import type { ScanFile } from "./detectors";
import type { RepoScan } from "./types";

// Enrichment and exposure both shell out (model call / git log) — the walk and
// the cache gate are what this file covers.
vi.mock("./ai-enrich", () => ({
  enrichSignalsWithAi: vi.fn(async (_files: ScanFile[], existing: unknown) => existing),
}));

vi.mock("./exposure", () => ({
  resolveAuthorEmails: vi.fn(async () => []),
  lastTouchedByMe: vi.fn(async () => null),
}));

vi.mock("./snapshots", () => ({
  readRepoScanCache: vi.fn(() => null),
  repoUnchanged: vi.fn(() => false),
}));

let repo: string;
let headSha: string;

/** Files handed to the enricher by the most recent scan. */
function scannedFiles(): ScanFile[] {
  return vi.mocked(enrichSignalsWithAi).mock.calls[0]![0] as ScanFile[];
}

function cachedScan(source: "local" | "github"): RepoScan {
  return {
    repoName: path.basename(repo),
    repoRef: repo,
    source,
    sha: headSha,
    depth: "full",
    scannedAt: "2026-01-01T00:00:00.000Z",
    signals: [
      { id: "cached-marker", label: "Cached", kind: "technology", area: "runtime", evidence: ["package.json"], count: 1, confidence: 0.9 },
    ],
    lastTouchedByMe: {},
  };
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "capability-local-scan-"));

  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ dependencies: { next: "^15.0.0" } }));
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src/app.ts"), "import next from 'next';\n");
  // Excluded by SECRET_FILE_RE.
  fs.writeFileSync(path.join(repo, ".env"), "AI_API_KEY=should-never-be-read\n");
  // Excluded by IGNORE_DIRS.
  fs.mkdirSync(path.join(repo, "node_modules/junk"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules/junk/index.js"), "module.exports = 1;\n");
  // Over MAX_CONTENT_BYTES (64KB) — walked, but content must not be loaded.
  fs.writeFileSync(path.join(repo, "src/huge.ts"), `// ${"x".repeat(70 * 1024)}\n`);

  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoUnchanged).mockReturnValue(false);
  vi.mocked(readRepoScanCache).mockReturnValue(null);
});

describe("scanLocalRepo", () => {
  it("walks the tree and reports the current HEAD", async () => {
    const scan = await scanLocalRepo(repo);

    expect(scan.source).toBe("local");
    expect(scan.depth).toBe("full");
    expect(scan.sha).toBe(headSha);
    expect(scan.repoRef).toBe(repo);
  });

  it("excludes secret files and ignored directories from the walk", async () => {
    await scanLocalRepo(repo);
    const paths = scannedFiles().map((f) => f.path);

    expect(paths).toContain("package.json");
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain(".env");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
  });

  it("walks oversized files but does not load their content", async () => {
    await scanLocalRepo(repo);
    const files = scannedFiles();

    expect(files.find((f) => f.path === "package.json")?.content).toContain("next");
    // Present in the file list, content withheld by the size cap.
    expect(files.some((f) => f.path === "src/huge.ts")).toBe(true);
    expect(files.find((f) => f.path === "src/huge.ts")?.content).toBeUndefined();
  });

  it("reuses the cached scan when HEAD has not moved", async () => {
    vi.mocked(repoUnchanged).mockReturnValue(true);
    vi.mocked(readRepoScanCache).mockReturnValue({
      repoName: path.basename(repo),
      sha: headSha,
      scannedAt: "2026-01-01T00:00:00.000Z",
      scan: cachedScan("local"),
    });

    const scan = await scanLocalRepo(repo);

    expect(scan.depth).toBe("cached");
    expect(scan.signals.map((s) => s.id)).toEqual(["cached-marker"]);
    // The whole point: no walk, no model call.
    expect(enrichSignalsWithAi).not.toHaveBeenCalled();
    // Reported fresh even though the signals are reused.
    expect(scan.scannedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("ignores a cache written by the remote probe for the same repo name", async () => {
    vi.mocked(repoUnchanged).mockReturnValue(true);
    vi.mocked(readRepoScanCache).mockReturnValue({
      repoName: path.basename(repo),
      sha: headSha,
      scannedAt: "2026-01-01T00:00:00.000Z",
      scan: cachedScan("github"),
    });

    const scan = await scanLocalRepo(repo);

    expect(scan.depth).toBe("full");
    expect(scan.signals.map((s) => s.id)).not.toContain("cached-marker");
    expect(enrichSignalsWithAi).toHaveBeenCalledTimes(1);
  });

  it("rescans when HEAD has moved", async () => {
    vi.mocked(repoUnchanged).mockReturnValue(false);
    vi.mocked(readRepoScanCache).mockReturnValue({
      repoName: path.basename(repo),
      sha: "stale-sha",
      scannedAt: "2026-01-01T00:00:00.000Z",
      scan: cachedScan("local"),
    });

    const scan = await scanLocalRepo(repo);

    expect(scan.depth).toBe("full");
    expect(enrichSignalsWithAi).toHaveBeenCalledTimes(1);
  });
});
