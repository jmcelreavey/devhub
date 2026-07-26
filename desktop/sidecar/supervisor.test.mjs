/**
 * Tests for the supervisor's config-file precedence.
 *
 * Run with: `node --test desktop/sidecar/supervisor.test.mjs`
 *
 * Plain `node:test` rather than Vitest: the supervisor ships inside the app
 * bundle and must run on the packaged Node runtime with no dependencies, so its
 * tests should not need a toolchain either.
 *
 * The rule these protect: **the shell owns infrastructure, the user owns their
 * content directories.** Getting that backwards meant a migrated user opened
 * the app to an empty notes vault — their data untouched on disk, and the app
 * looking somewhere else entirely.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A copy of `loadEnvFile` and `SHELL_OWNED` from supervisor.mjs.
 *
 * Duplicated deliberately: supervisor.mjs starts a server the moment it is
 * imported, so it cannot be required from a test. Kept small enough that
 * divergence is obvious in review, and the assertions below describe the
 * behaviour rather than the implementation.
 */
const SHELL_OWNED = new Set([
  "DEVHUB_DESKTOP",
  "DEVHUB_APP_DATA",
  "DEVHUB_RESOURCE_ROOT",
  "DEVHUB_SERVER_DIR",
  "DEVHUB_ENV_FILE",
  "DEVHUB_BOOTSTRAP_TOKEN",
  "PORT",
  "TERMINAL_PORT",
  "NODE_ENV",
]);

function loadEnvFile(envFile, env) {
  if (!envFile || !fs.existsSync(envFile)) return {};
  const loaded = {};
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || !value) continue;
    if (SHELL_OWNED.has(key)) continue;
    env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}

function withEnvFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-supervisor-"));
  const file = path.join(dir, ".env.local");
  fs.writeFileSync(file, contents);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a migrated content path overrides the shell's default", () => {
  // The regression this file exists for.
  const env = { NOTES_DIR: "/app-data/notes" };
  withEnvFile("NOTES_DIR=/Users/me/mirror/notes\n", (file) => loadEnvFile(file, env));
  assert.equal(env.NOTES_DIR, "/Users/me/mirror/notes");
});

test("every content directory is user-overridable", () => {
  const env = {
    NOTES_DIR: "/app-data/notes",
    TASKS_DIR: "/app-data/tasks",
    COLLECTIONS_DIR: "/app-data/collections",
    UPSTARTS_DIR: "/app-data/upstarts",
    DOCS_DIR: "/app-data/docs",
    DEVHUB_IDENTITY_FILE: "/app-data/persona/identity.txt",
  };
  withEnvFile(
    [
      "NOTES_DIR=/mine/notes",
      "TASKS_DIR=/mine/tasks",
      "COLLECTIONS_DIR=/mine/collections",
      "UPSTARTS_DIR=/mine/upstarts",
      "DOCS_DIR=/mine/docs",
      "DEVHUB_IDENTITY_FILE=/mine/identity.txt",
      "",
    ].join("\n"),
    (file) => loadEnvFile(file, env),
  );
  for (const [key, value] of Object.entries(env)) {
    assert.ok(value.startsWith("/mine/"), `${key} should have been overridden, got ${value}`);
  }
});

test("the config file cannot move the app bundle or app data", () => {
  const env = {
    DEVHUB_APP_DATA: "/real/app-data",
    DEVHUB_RESOURCE_ROOT: "/real/resources",
    DEVHUB_SERVER_DIR: "/real/server",
  };
  withEnvFile(
    "DEVHUB_APP_DATA=/evil\nDEVHUB_RESOURCE_ROOT=/evil\nDEVHUB_SERVER_DIR=/evil\n",
    (file) => loadEnvFile(file, env),
  );
  assert.equal(env.DEVHUB_APP_DATA, "/real/app-data");
  assert.equal(env.DEVHUB_RESOURCE_ROOT, "/real/resources");
  assert.equal(env.DEVHUB_SERVER_DIR, "/real/server");
});

test("the config file cannot change the bootstrap token", () => {
  // The auth boundary. A writable file that could set this would let anything
  // that can write to app data mint itself a valid desktop session.
  const env = { DEVHUB_BOOTSTRAP_TOKEN: "real-token" };
  withEnvFile("DEVHUB_BOOTSTRAP_TOKEN=attacker-chosen\n", (file) => loadEnvFile(file, env));
  assert.equal(env.DEVHUB_BOOTSTRAP_TOKEN, "real-token");
});

test("the config file cannot change the ports the shell already reserved", () => {
  const env = { PORT: "1337", TERMINAL_PORT: "1339" };
  withEnvFile("PORT=9999\nTERMINAL_PORT=9998\n", (file) => loadEnvFile(file, env));
  assert.equal(env.PORT, "1337");
  assert.equal(env.TERMINAL_PORT, "1339");
});

test("integration credentials are loaded", () => {
  const env = {};
  withEnvFile("JIRA_API_TOKEN=secret\nDATADOG_API_KEY=another\n", (file) => loadEnvFile(file, env));
  assert.equal(env.JIRA_API_TOKEN, "secret");
  assert.equal(env.DATADOG_API_KEY, "another");
});

test("comments, blanks, quotes and malformed lines are handled", () => {
  const env = {};
  withEnvFile(
    ['# a comment', '', 'QUOTED="value"', "SINGLE='other'", "NO_EQUALS_HERE", "EMPTY=", ""].join(
      "\n",
    ),
    (file) => loadEnvFile(file, env),
  );
  assert.equal(env.QUOTED, "value");
  assert.equal(env.SINGLE, "other");
  assert.equal(env.NO_EQUALS_HERE, undefined);
  // A blank value means "unset", not "set to empty" — an empty NOTES_DIR would
  // resolve to the process working directory.
  assert.equal(env.EMPTY, undefined);
});

test("a missing config file is not an error", () => {
  const env = { NOTES_DIR: "/app-data/notes" };
  assert.deepEqual(loadEnvFile("/nope/.env.local", env), {});
  assert.equal(env.NOTES_DIR, "/app-data/notes");
});
