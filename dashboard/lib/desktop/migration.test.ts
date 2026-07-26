import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MIGRATION_SCHEMA_VERSION,
  detectElectronInstall,
  planMigration,
  readMigrationRecord,
  runMigration,
} from "./migration";

/**
 * Migration tests, written around the promise rather than the implementation:
 * **install once, lose nothing, and never move a file the user did not agree
 * to move.** Every test below is a way that promise could be broken.
 */

let tmp: string;
let home: string;
let appData: string;
let checkout: string;

/** A believable Electron install: user data, a checkout, notes, config. */
function buildElectronInstall(opts: { withRemote?: boolean } = {}) {
  const userData = path.join(home, "Library", "Application Support", "DevHub");
  fs.mkdirSync(userData, { recursive: true });

  checkout = path.join(tmp, "devhub-checkout");
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(checkout, ".git", "config"),
    opts.withRemote
      ? '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:me/mirror.git\n'
      : "[core]\n\trepositoryformatversion = 0\n",
  );

  fs.writeFileSync(path.join(userData, "repo-path.txt"), checkout);

  for (const dir of ["notes", "tasks", "collections", "upstarts"]) {
    fs.mkdirSync(path.join(checkout, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(checkout, "notes", "important.md"), "do not lose me");
  fs.writeFileSync(path.join(checkout, "tasks", "2026-07-26.json"), "[]");

  fs.mkdirSync(path.join(checkout, "persona"), { recursive: true });
  fs.writeFileSync(path.join(checkout, "persona", "identity.txt"), "my personal tone");

  fs.mkdirSync(path.join(checkout, "dashboard"), { recursive: true });
  fs.writeFileSync(
    path.join(checkout, "dashboard", ".env.local"),
    [
      "JIRA_DOMAIN=example.atlassian.net",
      "JIRA_EMAIL=me@example.com",
      "JIRA_API_TOKEN=secret-token",
      "REPO_ROOT=" + checkout,
      "NOTES_DIR=" + path.join(checkout, "notes"),
      "# a comment",
      "SOMETHING_WEIRD=hello",
      "MALFORMED LINE WITH NO EQUALS",
      "",
    ].join("\n"),
  );

  return userData;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-migration-"));
  home = path.join(tmp, "home");
  appData = path.join(tmp, "app-data");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("detection", () => {
  it("finds an install and the checkout it recorded", () => {
    const userData = buildElectronInstall();
    const install = detectElectronInstall(home);
    expect(install?.userDataDir).toBe(userData);
    expect(install?.checkout).toBe(checkout);
    expect(install?.envFile).toBe(path.join(checkout, "dashboard", ".env.local"));
  });

  it("returns null when there is nothing to migrate", () => {
    expect(detectElectronInstall(home)).toBeNull();
  });

  it("ignores a recorded checkout that no longer exists", () => {
    const userData = path.join(home, "Library", "Application Support", "DevHub");
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, "repo-path.txt"), "/gone/missing");
    const install = detectElectronInstall(home);
    expect(install).not.toBeNull();
    expect(install?.checkout).toBeNull();
  });
});

describe("planning", () => {
  it("finds content that was only ever at an implicit default", () => {
    // The dangerous case: nothing records that notes live at <checkout>/notes.
    // A migration that only reads NOTES_DIR would silently miss tasks,
    // collections, and upstarts entirely.
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const keys = plan.paths.map((p) => p.key);
    expect(keys).toContain("TASKS_DIR");
    expect(keys).toContain("COLLECTIONS_DIR");
    expect(keys).toContain("UPSTARTS_DIR");

    const tasks = plan.paths.find((p) => p.key === "TASKS_DIR");
    expect(tasks?.explicit).toBe(false);
    expect(tasks?.exists).toBe(true);
  });

  it("defaults to keeping data in place for a checkout with a git remote", () => {
    // Someone's private mirror. Copying would fork their data away from the
    // git history they push to.
    buildElectronInstall({ withRemote: true });
    const plan = planMigration(appData, home);
    expect(plan.paths.find((p) => p.key === "NOTES_DIR")?.suggested).toBe("keep");
  });

  it("defaults to copying out of a checkout with no remote", () => {
    buildElectronInstall({ withRemote: false });
    const plan = planMigration(appData, home);
    expect(plan.paths.find((p) => p.key === "NOTES_DIR")?.suggested).toBe("copy");
  });

  it("always copies a personal identity, never leaves it behind", () => {
    buildElectronInstall({ withRemote: true });
    const plan = planMigration(appData, home);
    expect(plan.paths.find((p) => p.key === "DEVHUB_IDENTITY_FILE")?.suggested).toBe("copy");
  });

  it("reports config key names but never their values", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    expect(plan.configKeys).toContain("JIRA_API_TOKEN");
    expect(JSON.stringify(plan)).not.toContain("secret-token");
  });

  it("counts unrecognised lines rather than importing them", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    // SOMETHING_WEIRD and the malformed line.
    expect(plan.unknownLineCount).toBeGreaterThanOrEqual(2);
  });

  it("plans nothing when there is no install", () => {
    const plan = planMigration(appData, home);
    expect(plan.install).toBeNull();
    expect(plan.paths).toEqual([]);
  });
});

describe("running", () => {
  it("copies content and points config at the copy", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({
      plan,
      choices: [{ key: "NOTES_DIR", action: "copy" }],
      appDataDir: appData,
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(appData, "notes", "important.md"), "utf-8")).toBe(
      "do not lose me",
    );
    expect(result.envUpdates.get("NOTES_DIR")).toBe(path.join(appData, "notes"));
  });

  it("leaves the source completely untouched", () => {
    // The whole promise. A failed or unwanted migration must cost nothing.
    buildElectronInstall();
    const plan = planMigration(appData, home);
    runMigration({ plan, choices: [{ key: "NOTES_DIR", action: "copy" }], appDataDir: appData });

    expect(fs.existsSync(path.join(checkout, "notes", "important.md"))).toBe(true);
    expect(fs.readFileSync(path.join(checkout, "notes", "important.md"), "utf-8")).toBe(
      "do not lose me",
    );
    expect(fs.existsSync(path.join(checkout, "dashboard", ".env.local"))).toBe(true);
  });

  it("keep-in-place copies nothing and points at the original", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({
      plan,
      choices: [{ key: "NOTES_DIR", action: "keep" }],
      appDataDir: appData,
    });

    expect(result.envUpdates.get("NOTES_DIR")).toBe(path.join(checkout, "notes"));
    expect(fs.existsSync(path.join(appData, "notes", "important.md"))).toBe(false);
  });

  it("never overwrites a file that already exists in the new install", () => {
    // Someone who set up fresh, wrote a note, then decided to import.
    buildElectronInstall();
    fs.mkdirSync(path.join(appData, "notes"), { recursive: true });
    fs.writeFileSync(path.join(appData, "notes", "important.md"), "mine, written after install");

    const plan = planMigration(appData, home);
    runMigration({ plan, choices: [{ key: "NOTES_DIR", action: "copy" }], appDataDir: appData });

    expect(fs.readFileSync(path.join(appData, "notes", "important.md"), "utf-8")).toBe(
      "mine, written after install",
    );
  });

  it("imports recognised keys and quarantines the rest", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({ plan, choices: [], appDataDir: appData });

    expect(result.envUpdates.get("JIRA_API_TOKEN")).toBe("secret-token");
    expect(result.quarantineFile).toBeTruthy();

    const quarantined = fs.readFileSync(result.quarantineFile!, "utf-8");
    expect(quarantined).toContain("SOMETHING_WEIRD=hello");
    expect(quarantined).toContain("MALFORMED LINE WITH NO EQUALS");
    // Quarantined means not imported.
    expect(result.envUpdates.has("SOMETHING_WEIRD")).toBe(false);
  });

  it("does not import REPO_ROOT — an installed app has no checkout", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({ plan, choices: [], appDataDir: appData });
    expect(result.envUpdates.has("REPO_ROOT")).toBe(false);
  });

  it("does not let the legacy NOTES_DIR undo a copy decision", () => {
    // The old .env.local sets NOTES_DIR to the checkout. Importing config
    // after deciding to copy would point straight back at the original and
    // make the copy pointless.
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({
      plan,
      choices: [{ key: "NOTES_DIR", action: "copy" }],
      appDataDir: appData,
    });
    expect(result.envUpdates.get("NOTES_DIR")).toBe(path.join(appData, "notes"));
  });

  it("infers the code folder from where the checkout lived", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({ plan, choices: [], appDataDir: appData });
    expect(result.envUpdates.get("DEVHUB_REPOS_DIR")).toBe(path.dirname(checkout));
  });

  it("is idempotent — a second run duplicates nothing", () => {
    buildElectronInstall();
    const first = planMigration(appData, home);
    runMigration({ plan: first, choices: [{ key: "NOTES_DIR", action: "copy" }], appDataDir: appData });

    const second = planMigration(appData, home);
    expect(second.alreadyMigrated).toBe(true);

    const before = fs.readdirSync(path.join(appData, "notes"));
    runMigration({ plan: second, choices: [{ key: "NOTES_DIR", action: "copy" }], appDataDir: appData });
    expect(fs.readdirSync(path.join(appData, "notes"))).toEqual(before);
  });

  it("records what it did, so a human can audit it later", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    runMigration({
      plan,
      choices: [{ key: "NOTES_DIR", action: "copy" }],
      appDataDir: appData,
      appVersion: "2.0.0",
    });

    const record = readMigrationRecord(appData);
    expect(record?.schemaVersion).toBe(MIGRATION_SCHEMA_VERSION);
    expect(record?.appVersion).toBe("2.0.0");
    expect(record?.sourceCheckout).toBe(checkout);
    expect(record?.decisions.find((d) => d.key === "NOTES_DIR")?.action).toBe("copy");
    expect(record?.migratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("skips a path the user chose to skip", () => {
    buildElectronInstall();
    const plan = planMigration(appData, home);
    const result = runMigration({
      plan,
      choices: [{ key: "NOTES_DIR", action: "skip" }],
      appDataDir: appData,
    });
    expect(result.envUpdates.has("NOTES_DIR")).toBe(false);
    expect(fs.existsSync(path.join(appData, "notes", "important.md"))).toBe(false);
  });

  it("fails cleanly when there is nothing to migrate", () => {
    const plan = planMigration(appData, home);
    const result = runMigration({ plan, choices: [], appDataDir: appData });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no existing devhub/i);
  });
});
