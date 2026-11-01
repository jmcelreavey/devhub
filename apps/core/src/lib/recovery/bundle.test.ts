import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBundle, inventory, restoreBundle } from "./bundle";
import { recoveryStores } from "./stores";
import { closeSqliteDatabase, openSqliteDatabase, sqliteDatabasePath } from "../../domains/storage/sqlite";

let root: string;
const passphrase = "fixture-only-recovery-passphrase";
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-recovery-test-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
function store(id = "notes") {
  const source = path.join(root, id);
  fs.mkdirSync(source, { recursive: true });
  return { id, source };
}
function sealed(records: unknown[]) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.concat([Buffer.from("DEVHUBB1\n"), salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(gzipSync(records.map(value => JSON.stringify(value)).join("\n") + "\n")), cipher.final()]);
  const file = path.join(root, "crafted.devhub");
  fs.writeFileSync(file, Buffer.concat([header, body, cipher.getAuthTag()]));
  return file;
}
describe("portable encrypted recovery", () => {
  it("round-trips Unicode across chunks, remaps configuration and keeps notes unchanged", async () => {
    const notes = store(), config = store("config"), empty = store("tasks");
    const text = "🌍 café 学習 ".repeat(15_000) + notes.source;
    fs.writeFileSync(path.join(notes.source, "文書.json"), text);
    fs.writeFileSync(path.join(config.source, "paths.json"), JSON.stringify({ notes: notes.source, repo: "/old/repos/app" }));
    const bundle = path.join(root, "backup.devhub");
    expect((await createBundle([notes, config, empty], passphrase, bundle, "/old/repos")).files).toBe(2);
    expect(fs.readFileSync(bundle).includes(Buffer.from("café"))).toBe(false);
    const restored = await restoreBundle(bundle, passphrase, root, { repositoriesRoot: "/new/repos" });
    expect(fs.readFileSync(path.join(restored.destination, "notes/文書.json"), "utf8")).toBe(text);
    expect(JSON.parse(fs.readFileSync(path.join(restored.destination, "config/paths.json"), "utf8"))).toEqual({ notes: path.join(restored.destination, "notes"), repo: "/new/repos/app" });
    expect(fs.statSync(path.join(restored.destination, "tasks")).isDirectory()).toBe(true);
    expect(fs.statSync(restored.destination).mode & 0o777).toBe(0o700);
  });
  it("backs up committed SQLite WAL contents using a consistent snapshot", async () => {
    const data = store("state"), file = path.join(data.source, "history.sqlite");
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE entries(value TEXT); INSERT INTO entries VALUES ('committed in WAL');");
      const bundle = path.join(root, "sqlite.devhub");
      await createBundle([data], passphrase, bundle);
      const restored = await restoreBundle(bundle, passphrase, root);
      const recovered = new DatabaseSync(path.join(restored.destination, "state/history.sqlite"), { readOnly: true });
      try { expect(recovered.prepare("SELECT value FROM entries").get()?.value).toBe("committed in WAL"); }
      finally { recovered.close(); }
    } finally { db.close(); }
  });
  it("includes the agent database from custom desktop state in the recovery bundle", async () => {
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_STATE_HOME", path.join(root, "state"));
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", path.join(root, "custom-app"));
    vi.stubEnv("DEVHUB_STATE_PROFILE", "");
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_CONTENT_ROOT", path.join(root, "content"));
    const filename = sqliteDatabasePath();
    const db = openSqliteDatabase();
    try {
      db.exec("CREATE TABLE recovery_fixture(value TEXT); INSERT INTO recovery_fixture VALUES (\u0027in WAL\u0027)");
      const bundle = path.join(root, "agent-runs.devhub");
      await createBundle(recoveryStores(), passphrase, bundle);
      const restored = await restoreBundle(bundle, passphrase, root);
      const recovered = new DatabaseSync(path.join(restored.destination, "sqlite", "devhub.db"), { readOnly: true });
      try { expect(recovered.prepare("SELECT value FROM recovery_fixture").get()?.value).toBe("in WAL"); }
      finally { recovered.close(); }
    } finally {
      closeSqliteDatabase(filename);
      vi.unstubAllEnvs();
    }
  });
  it("rolls back a failed restore without touching live files or previous restores", async () => {
    const notes = store(); fs.writeFileSync(path.join(notes.source, "a.json"), "live");
    const bundle = path.join(root, "backup.devhub");
    await createBundle([notes], passphrase, bundle);
    const before = fs.readdirSync(root).sort();
    await expect(restoreBundle(bundle, passphrase, root, { failAfterFiles: 1 })).rejects.toThrow("rolled back");
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(notes.source, "a.json"), "utf8")).toBe("live");
  });
  it("rolls back wrong passphrases and authenticated-content tampering", async () => {
    const notes = store(); fs.writeFileSync(path.join(notes.source, "a"), "kept");
    const bundle = path.join(root, "backup.devhub"); await createBundle([notes], passphrase, bundle);
    await expect(restoreBundle(bundle, "wrong-but-long-enough", root)).rejects.toThrow("rolled back");
    const bytes = fs.readFileSync(bundle); bytes[bytes.length - 20] ^= 1; fs.writeFileSync(bundle, bytes);
    await expect(restoreBundle(bundle, passphrase, root)).rejects.toThrow("rolled back");
    expect(fs.readdirSync(root).filter(name => name.startsWith("devhub-restored-"))).toEqual([]);
  });
  it.each(["notes/../escaped", "/absolute", "notes\\escaped"])("rejects unsafe archive name %s", async name => {
    const bundle = sealed([{ manifest: { format: "devhub-backup", version: 1, createdAt: "", roots: [{ id: "notes", source: "/old/notes" }] } }, { file: name, bytes: 0 }]);
    await expect(restoreBundle(bundle, passphrase, root)).rejects.toThrow("Invalid backup file");
    expect(fs.readdirSync(root)).toEqual(["crafted.devhub"]);
  });
  it("refuses symbolic links and preserves an existing output file", async () => {
    const notes = store(); fs.writeFileSync(path.join(notes.source, "a"), "kept");
    const bundle = path.join(root, "existing"); fs.writeFileSync(bundle, "previous backup");
    await expect(createBundle([notes], passphrase, bundle)).rejects.toThrow();
    expect(fs.readFileSync(bundle, "utf8")).toBe("previous backup");
    fs.symlinkSync(path.join(notes.source, "a"), path.join(notes.source, "link"));
    await expect(inventory([notes])).rejects.toThrow("symbolic link");
  });
});
