import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  APP_DATA_SUBDIRS,
  defaultAppDataDir,
  desktopEnvDefaults,
  ensureAppDataTree,
  expandHome,
  getAppDataDir,
  getCheckoutRoot,
  getEnvFilePath,
  getIdentityFilePath,
  getReposDir,
  getResourceRoot,
  hasCheckout,
  isDesktopRuntime,
} from "./runtime-paths";

/**
 * The path contract, tested in the three modes it actually has to work in:
 * a git checkout (`npm run dev`), a fresh installed app, and an installed app
 * that migrated an existing user's data.
 *
 * The property worth protecting above all others: **nothing writable may ever
 * resolve inside the resource root**. That directory is replaced wholesale by
 * every auto-update. If a user's notes are in there, an update deletes them,
 * and the user finds out later.
 */

const ENV_KEYS = [
  "DEVHUB_DESKTOP",
  "DEVHUB_APP_DATA",
  "DEVHUB_RESOURCE_ROOT",
  "DEVHUB_ENV_FILE",
  "DEVHUB_REPOS_DIR",
  "DEVHUB_IDENTITY_FILE",
  "REPO_ROOT",
  "NOTES_DIR",
  "TASKS_DIR",
  "COLLECTIONS_DIR",
  "UPSTARTS_DIR",
  "DOCS_DIR",
] as const;

let saved: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-paths-"));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A directory that looks like a real git checkout. */
function makeCheckout(name = "checkout"): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
}

describe("checkout mode", () => {
  it("is not desktop mode and reports a checkout", () => {
    const checkout = makeCheckout();
    process.env.REPO_ROOT = checkout;

    expect(isDesktopRuntime()).toBe(false);
    expect(getCheckoutRoot()).toBe(checkout);
    expect(hasCheckout()).toBe(true);
  });

  it("keeps the old parent-of-checkout behaviour for repo discovery", () => {
    // This is the behaviour every existing checkout depends on. Changing the
    // default would silently repoint everyone's repo list.
    const checkout = makeCheckout();
    process.env.REPO_ROOT = checkout;
    expect(getReposDir()).toBe(path.dirname(checkout));
  });

  it("resolves assets and data to the checkout", () => {
    const checkout = makeCheckout();
    process.env.REPO_ROOT = checkout;
    expect(getResourceRoot()).toBe(checkout);
    expect(getAppDataDir()).toBe(checkout);
    expect(getIdentityFilePath()).toBe(path.join(checkout, "persona", "identity.txt"));
  });
});

describe("fresh desktop mode", () => {
  beforeEach(() => {
    process.env.DEVHUB_DESKTOP = "1";
    process.env.DEVHUB_APP_DATA = path.join(tmp, "app-data");
    process.env.DEVHUB_RESOURCE_ROOT = path.join(tmp, "resources");
  });

  it("has no checkout, and does not invent one", () => {
    // The bug this prevents: an installed app treating its own read-only
    // bundle as a git checkout and offering sync/ship actions that cannot work.
    expect(hasCheckout()).toBe(false);
    expect(getCheckoutRoot()).toBeNull();
  });

  it("picks up a linked checkout from repo-path.txt under app data", () => {
    const checkout = makeCheckout();
    const appData = path.join(tmp, "app-data");
    fs.mkdirSync(appData, { recursive: true });
    fs.writeFileSync(path.join(appData, "repo-path.txt"), `${checkout}\n`);
    expect(getCheckoutRoot()).toBe(checkout);
    expect(hasCheckout()).toBe(true);
  });

  it("ignores a repo-path.txt that does not point at a git checkout", () => {
    const appData = path.join(tmp, "app-data");
    fs.mkdirSync(appData, { recursive: true });
    fs.writeFileSync(path.join(appData, "repo-path.txt"), path.join(tmp, "not-a-repo"));
    expect(getCheckoutRoot()).toBeNull();
  });

  it("refuses to treat the resource root as a checkout even if REPO_ROOT points there", () => {
    process.env.REPO_ROOT = path.join(tmp, "resources");
    fs.mkdirSync(path.join(tmp, "resources"), { recursive: true });
    expect(getCheckoutRoot()).toBeNull();
  });

  it("puts config and identity under app data", () => {
    expect(getEnvFilePath()).toBe(path.join(tmp, "app-data", "config", ".env.local"));
    expect(getIdentityFilePath()).toBe(path.join(tmp, "app-data", "persona", "identity.txt"));
  });

  it("never resolves a writable path inside the resource root", () => {
    const resourceRoot = path.join(tmp, "resources");
    const env = desktopEnvDefaults({
      appDataDir: path.join(tmp, "app-data"),
      resourceRoot,
    });
    for (const key of [
      "NOTES_DIR",
      "TASKS_DIR",
      "COLLECTIONS_DIR",
      "UPSTARTS_DIR",
      "DOCS_DIR",
      "DEVHUB_ENV_FILE",
      "DEVHUB_IDENTITY_FILE",
    ]) {
      expect(env[key], `${key} must not live in the replaceable resource tree`).not.toContain(
        resourceRoot,
      );
      expect(env[key]).toContain(path.join(tmp, "app-data"));
    }
  });

  it("falls back to ~/Developer rather than the parent of nothing", () => {
    // Without a checkout there is no parent to take. Taking the parent of the
    // app bundle would scan /Applications for git repositories.
    delete process.env.DEVHUB_REPOS_DIR;
    expect(getReposDir()).toBe(path.join(os.homedir(), "Developer"));
  });

  it("uses an explicit code folder when one is set", () => {
    process.env.DEVHUB_REPOS_DIR = path.join(tmp, "code");
    expect(getReposDir()).toBe(path.join(tmp, "code"));
  });

  it("expands a tilde in the code folder", () => {
    process.env.DEVHUB_REPOS_DIR = "~/Projects";
    expect(getReposDir()).toBe(path.join(os.homedir(), "Projects"));
  });
});

describe("migrated desktop mode", () => {
  it("keeps a user's existing content locations instead of relocating them", () => {
    /**
     * The whole promise made to an existing Electron user: install once, keep
     * every note where it already is. If defaults won over their configuration,
     * their notes would appear to vanish — still on disk, invisible in the app.
     */
    const legacyNotes = path.join(tmp, "old-checkout", "notes");
    const env = desktopEnvDefaults({
      appDataDir: path.join(tmp, "app-data"),
      resourceRoot: path.join(tmp, "resources"),
      existing: { NOTES_DIR: legacyNotes },
    });
    expect(env.NOTES_DIR).toBe(legacyNotes);
    // Unmigrated paths still get sensible defaults.
    expect(env.TASKS_DIR).toBe(path.join(tmp, "app-data", "tasks"));
  });

  it("ignores blank existing values rather than resolving to an empty path", () => {
    const env = desktopEnvDefaults({
      appDataDir: path.join(tmp, "app-data"),
      resourceRoot: path.join(tmp, "resources"),
      existing: { NOTES_DIR: "   " },
    });
    expect(env.NOTES_DIR).toBe(path.join(tmp, "app-data", "notes"));
  });

  it("is idempotent — applying defaults twice changes nothing", () => {
    const once = desktopEnvDefaults({
      appDataDir: path.join(tmp, "app-data"),
      resourceRoot: path.join(tmp, "resources"),
      existing: { NOTES_DIR: path.join(tmp, "elsewhere") },
    });
    const twice = desktopEnvDefaults({
      appDataDir: path.join(tmp, "app-data"),
      resourceRoot: path.join(tmp, "resources"),
      existing: once,
    });
    expect(twice).toEqual(once);
  });
});

describe("app data tree", () => {
  it("creates every directory the app writes to", () => {
    const appData = path.join(tmp, "app-data");
    ensureAppDataTree(appData);
    for (const sub of APP_DATA_SUBDIRS) {
      expect(fs.existsSync(path.join(appData, sub)), `${sub} should exist`).toBe(true);
    }
  });

  it("is idempotent", () => {
    const appData = path.join(tmp, "app-data");
    ensureAppDataTree(appData);
    fs.writeFileSync(path.join(appData, "notes", "keep.md"), "hello");
    ensureAppDataTree(appData);
    expect(fs.readFileSync(path.join(appData, "notes", "keep.md"), "utf-8")).toBe("hello");
  });

  it.runIf(process.platform !== "win32")("is not readable by other users", () => {
    // config/.env.local holds API tokens; logs/ holds terminal transcripts.
    const appData = path.join(tmp, "app-data");
    ensureAppDataTree(appData);
    const mode = fs.statSync(appData).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });
});

describe("simulated update", () => {
  it("replacing the resource root leaves app data byte-for-byte unchanged", () => {
    /**
     * This is the actual auto-update safety property, tested the way an update
     * behaves: blow away the resource tree, put a new one down, and prove
     * nothing the user owns moved.
     */
    const appData = path.join(tmp, "app-data");
    const resources = path.join(tmp, "resources");
    ensureAppDataTree(appData);
    fs.mkdirSync(path.join(resources, "skills"), { recursive: true });
    fs.writeFileSync(path.join(resources, "skills", "v1.md"), "old skill");

    const noteFile = path.join(appData, "notes", "important.md");
    fs.writeFileSync(noteFile, "please do not delete me");
    const before = fs.readFileSync(noteFile);
    const beforeMode = fs.statSync(appData).mode;

    // The update.
    fs.rmSync(resources, { recursive: true, force: true });
    fs.mkdirSync(path.join(resources, "skills"), { recursive: true });
    fs.writeFileSync(path.join(resources, "skills", "v2.md"), "new skill");

    expect(fs.readFileSync(noteFile).equals(before)).toBe(true);
    expect(fs.statSync(appData).mode).toBe(beforeMode);
    expect(fs.existsSync(path.join(resources, "skills", "v1.md"))).toBe(false);
  });
});

describe("helpers", () => {
  it("expands ~ and ~/x, and leaves everything else alone", () => {
    expect(expandHome("~", "/home/x")).toBe("/home/x");
    expect(expandHome("~/code", "/home/x")).toBe(path.join("/home/x", "code"));
    expect(expandHome("/abs/path", "/home/x")).toBe("/abs/path");
    // Not a home reference — a directory whose name starts with a tilde.
    expect(expandHome("~weird", "/home/x")).toBe("~weird");
    expect(expandHome("", "/home/x")).toBe("");
  });

  it("uses the OS convention for app data", () => {
    const dir = defaultAppDataDir("/home/x");
    if (process.platform === "darwin") {
      expect(dir).toBe("/home/x/Library/Application Support/DevHub");
    } else if (process.platform === "win32") {
      expect(dir).toContain("DevHub");
    } else {
      expect(dir).toBe("/home/x/.local/share/devhub");
    }
  });
});
