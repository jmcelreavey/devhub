import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitEnv, runGitRepo, runGitRepoAsync } from "./repo-local";

/**
 * A packaged DevHub server runs with NPM_CONFIG_PREFIX (its tools dir) and the
 * payload's Node first on PATH. A user's pre-push hook that sources nvm then
 * dies: nvm refuses to load while that variable is set ("nvm is not compatible
 * with the NPM_CONFIG_PREFIX environment variable", rc 11), so a content sync
 * from the app can never push. The fake nvm.sh below applies the same check.
 */
const FAKE_NVM = `# Same guard as the real nvm.sh.
if [ -n "\${NPM_CONFIG_PREFIX-}" ] || [ -n "\${npm_config_prefix-}" ]; then
  echo 'nvm is not compatible with the "NPM_CONFIG_PREFIX" environment variable' >&2
  return 11
fi
PATH="$NVM_DIR/versions/node/v22.0.0/bin:$PATH"
export PATH
`;

const HOOK = `#!/bin/sh
. "$NVM_DIR/nvm.sh" || exit 11
npm --version >/dev/null || exit 12
printf '%s' "$PATH" > "$HOOK_PATH_LOG"
`;

let root: string;
let repo: string;
let runtimeDir: string;
let userBin: string;
let pathLog: string;
let saved: NodeJS.ProcessEnv;

function write(file: string, body: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
}

/** What the packaged sidecar's managed env looks like to a child of the server. */
function packagedServerEnv(): NodeJS.ProcessEnv {
  const home = path.join(root, "home");
  const tools = path.join(home, ".local", "share", "devhub", "tools");
  const env = {
    HOME: home,
    NVM_DIR: path.join(root, "nvm"),
    HOOK_PATH_LOG: pathLog,
    NPM_CONFIG_PREFIX: tools,
    npm_config_prefix: tools,
    DEVHUB_PACKAGED_RUNTIME: "1",
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    PATH: [
      path.join(tools, "bin"),
      runtimeDir,
      path.join(runtimeDir, "npm-bin"),
      userBin,
      saved.PATH ?? "/usr/bin:/bin",
    ].join(path.delimiter),
  } as unknown as NodeJS.ProcessEnv;
  return env;
}

function useEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

beforeEach(() => {
  saved = { ...process.env };
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-hook-env-")));
  repo = path.join(root, "work");
  runtimeDir = path.dirname(process.execPath);
  userBin = path.join(root, "home", "bin");
  pathLog = path.join(root, "hook-path.txt");

  write(path.join(root, "nvm", "nvm.sh"), FAKE_NVM);
  write(path.join(root, "nvm", "versions", "node", "v22.0.0", "bin", "npm"), "#!/bin/sh\necho 10.9.0\n", 0o755);
  write(path.join(root, "gitconfig"), "[user]\n\tname = T\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n");

  // A clean env for the setup, not the pre-push hook's GIT_DIR this suite may run inside.
  useEnv(packagedServerEnv());
  const setup = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...packagedServerEnv(), NPM_CONFIG_PREFIX: "", npm_config_prefix: "" } });
    expect(r.status, r.stderr).toBe(0);
  };
  fs.mkdirSync(path.join(root, "remote.git"));
  setup(path.join(root, "remote.git"), "init", "--bare", "-q");
  fs.mkdirSync(repo);
  setup(repo, "init", "-q");
  setup(repo, "remote", "add", "origin", path.join(root, "remote.git"));
  write(path.join(repo, "notes", "a.md"), "hello\n");
  setup(repo, "add", "-A");
  setup(repo, "commit", "-q", "-m", "init");
  write(path.join(repo, ".git", "hooks", "pre-push"), HOOK, 0o755);
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("git run by the dashboard under the packaged server env", () => {
  it("pushes through a pre-push hook that sources nvm", () => {
    const result = runGitRepo(repo, ["push", "origin", "main"]);
    expect(result.stderr).not.toContain("NPM_CONFIG_PREFIX");
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, "remote.git", "refs", "heads", "main"))).toBe(true);
  });

  it("pushes through the async helper too", async () => {
    const result = await runGitRepoAsync(repo, ["push", "origin", "main"]);
    expect(result.status).toBe(0);
  });

  it("keeps the bundled Node last on PATH and never exposes the private npm-bin", () => {
    expect(runGitRepo(repo, ["push", "origin", "main"]).status).toBe(0);
    const segments = fs.readFileSync(pathLog, "utf-8").split(path.delimiter);
    expect(segments).not.toContain(path.join(runtimeDir, "npm-bin"));
    expect(segments.indexOf(userBin)).toBeGreaterThan(-1);
    expect(segments.indexOf(userBin)).toBeLessThan(segments.indexOf(runtimeDir));
    expect(segments.indexOf(runtimeDir)).toBeGreaterThan(segments.indexOf(path.join(root, "nvm", "versions", "node", "v22.0.0", "bin")));
  });

  it("passes a per-command variable to the hook without letting the server's DEVHUB_* through", () => {
    process.env.DEVHUB_DESKTOP = "1";
    const env = gitEnv({ DEVHUB_PREPUSH: "content" });
    expect(env.DEVHUB_PREPUSH).toBe("content");
    expect(env.DEVHUB_DESKTOP).toBeUndefined();
    expect(gitEnv().DEVHUB_PREPUSH).toBeUndefined();
  });

  it("regression guard: the raw managed env is what makes that hook fail", () => {
    const raw = spawnSync("git", ["push", "origin", "main"], { cwd: repo, encoding: "utf-8", env: packagedServerEnv() });
    expect(raw.status).not.toBe(0);
    expect(raw.stderr).toContain("nvm is not compatible with the \"NPM_CONFIG_PREFIX\"");
  });
});
