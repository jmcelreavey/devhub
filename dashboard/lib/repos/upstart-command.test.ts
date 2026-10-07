import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { repoUpstartCommand } from "./upstart-command";

let tmp: string;
let main: string;
let worktree: string;
let script: string;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "upstart checkout-")));
  main = path.join(tmp, "main repo");
  worktree = path.join(tmp, "linked 'checkout");
  fs.mkdirSync(main);
  await execExternal("git", ["init", main]);
  await execExternal("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"], { cwd: main });
  await execExternal("git", ["worktree", "add", "--detach", worktree], { cwd: main });
  for (const root of [main, worktree]) {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "package.json"), '{"dependencies":{"expo":"test"}}');
    fs.writeFileSync(path.join(root, ".env.example"), "CONFIG=example\n");
  }
  script = path.join(tmp, "stored 'upstart.sh");
  // Exercise the real root/env bootstrap without installing packages or starting devices.
  const app = fs.readFileSync(path.resolve("../upstarts/app/upstart.sh"), "utf8");
  const marker = '\ninfo "app upstart (mode=$MODE platform=$PLATFORM)"';
  expect(app).toContain(marker);
  fs.writeFileSync(script, app.slice(0, app.indexOf(marker)) + '\nensure_env_file\nprintf "%s\\n" "$PWD"\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function run(cwd: string, useLauncher = true) {
  const env = { ...process.env, DEVHUB_UPSTART_MODE: "expo", DEVHUB_UPSTART_PLATFORM: "metro" };
  return useLauncher
    ? execExternal("bash", ["-c", repoUpstartCommand(script, cwd)], { cwd: tmp, env })
    : execExternal("bash", [script], { cwd, env });
}

describe("upstart checkout bootstrap", () => {
  it("defaults a fresh dev-client checkout to a native build without ios/", async () => {
    fs.writeFileSync(path.join(worktree, "package.json"), '{"dependencies":{"expo":"test","expo-dev-client":"test"}}');
    fs.appendFileSync(script, '\nprintf "%s" "$MODE"\n');
    const env = { ...process.env, DEVHUB_UPSTART_MODE: "", DEVHUB_UPSTART_PLATFORM: "metro" };
    const result = await execExternal("bash", [script], { cwd: worktree, env });
    expect(result.stdout).toMatch(/dev-client$/);
  });

  it("rebuilds when another worktree replaced the installed iOS binary", async () => {
    fs.mkdirSync(path.join(worktree, "ios"));
    fs.writeFileSync(path.join(worktree, "ios/.upstart-build-stamp"), "fingerprint bundle simulator old-binary\n");
    fs.appendFileSync(script, [
      'BUNDLE_ID_IOS=bundle', 'IOS_SIMULATOR_UDID=simulator',
      'installed_ios_build_hash() { echo new-binary; }',
      'ios_native_fingerprint() { echo fingerprint; }',
      'if ios_build_is_current; then exit 21; fi',
      'installed_ios_build_hash() { echo old-binary; }',
      'ios_build_is_current',
    ].join("\n"));
    await run(worktree);
  });

  it("reopens a reused iOS build once its Metro server is ready", async () => {
    fs.appendFileSync(script, [
      'PLATFORM=ios', 'IOS_SIMULATOR_UDID=simulator', 'BUNDLE_ID_IOS=bundle',
      'resolve_app_identifiers() { :; }', 'require_xcode() { :; }',
      'ios_build_is_current() { return 0; }',
      'metro_running() { [[ -f metro-ready ]]; }',
      'start_metro() { touch metro-ready; }',
      'open() { :; }',
      'xcrun() {',
      '  case "$1 $2" in',
      '    "simctl list"|"simctl bootstatus") echo "    iPhone (simulator) (Booted)"; return 0 ;;',
      '  esac',
      '  [[ -f metro-ready ]] || return 1',
      '  echo "$*" >> launches',
      '}',
      'start_native',
      'wait "${BACKGROUND_PIDS[@]}"',
    ].join("\n"));
    await run(worktree);
    expect(fs.readFileSync(path.join(worktree, "launches"), "utf8")).toContain("simctl launch --terminate-running-process simulator bundle");
  });

  it("uses an isolated HTTP/1.1 retry for CDN errors and preserves native files on other errors", async () => {
    fs.mkdirSync(path.join(worktree, "ios"));
    fs.writeFileSync(path.join(worktree, "ios/Podfile.lock"), "keep");
    const stub = path.join(tmp, "bin");
    fs.mkdirSync(stub);
    fs.writeFileSync(path.join(stub, "pod"), [
      '#!/usr/bin/env bash',
      'if [[ "${POD_FAILURE:-}" == "target" ]]; then echo "minimum deployment target"; exit 1; fi',
      'if [[ "${RUBYOPT:-}" == *app-pods-http1* ]]; then echo "fallback succeeded"; exit 0; fi',
      'echo "Error in the HTTP2 framing layer"; exit 1',
    ].join("\n"), { mode: 0o755 });
    fs.appendFileSync(script, "\ninstall_ios_pods\n");
    const env = { ...process.env, PATH: stub + path.delimiter + process.env.PATH, DEVHUB_UPSTART_MODE: "expo", DEVHUB_UPSTART_PLATFORM: "metro" };
    const result = await execExternal("bash", [script], { cwd: worktree, env });
    expect(result.stdout).toContain("fallback succeeded");
    await expect(execExternal("bash", [script], { cwd: worktree, env: { ...env, POD_FAILURE: "target" } })).rejects.toThrow();
    expect(fs.readFileSync(path.join(worktree, "ios/Podfile.lock"), "utf8")).toBe("keep");
  });

  it("copies main .env into a linked checkout and runs at its root from a subdirectory", async () => {
    fs.writeFileSync(path.join(main, ".env"), "CONFIG=main\n", { mode: 0o644 });
    const result = await run(path.join(worktree, "src"));
    expect(result.stdout.trim().split("\n").at(-1)).toBe(worktree);
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf8")).toBe("CONFIG=main\n");
    expect(fs.statSync(path.join(worktree, ".env")).mode & 0o777).toBe(0o600);
  });

  it("normalizes the root during direct manual invocation too", async () => {
    await run(path.join(worktree, "src"), false);
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf8")).toBe("CONFIG=example\n");
    expect(fs.existsSync(path.join(worktree, "src", ".env"))).toBe(false);
  });

  it("preserves the existing worktree env byte for byte", async () => {
    fs.writeFileSync(path.join(main, ".env"), "CONFIG=main\n");
    fs.writeFileSync(path.join(worktree, ".env"), "CONFIG=local");
    await run(worktree);
    expect(fs.readFileSync(path.join(worktree, ".env"), "utf8")).toBe("CONFIG=local");
  });

  it("supports the main checkout and its example fallback", async () => {
    const result = await run(path.join(main, "src"));
    expect(result.stdout.trim().split("\n").at(-1)).toBe(main);
    expect(fs.readFileSync(path.join(main, ".env"), "utf8")).toBe("CONFIG=example\n");
  });

  it("rejects a dangling env symlink without replacing it", async () => {
    fs.symlinkSync(path.join(tmp, "missing-env"), path.join(worktree, ".env"));
    await expect(run(worktree)).rejects.toThrow(/not a readable file/);
    expect(fs.lstatSync(path.join(worktree, ".env")).isSymbolicLink()).toBe(true);
  });

  it("does not execute the script outside a checkout", async () => {
    await expect(run(tmp)).rejects.toThrow();
    expect(fs.existsSync(path.join(tmp, ".env"))).toBe(false);
    await expect(run(tmp, false)).rejects.toThrow(/inside the app repository/);
  });
});
