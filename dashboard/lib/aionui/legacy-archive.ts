import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getNotesDir } from "@/lib/notes/dir";

function directory() { return path.join(getNotesDir(), ".config", "agent-chat-archive"); }
const ID = /^[a-f0-9]{64}$/;

export function archiveLegacyChats(raw: string) {
  const id = createHash("sha256").update(raw).digest("hex");
  const root = directory();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${id}.json`);
  try { fs.writeFileSync(file, JSON.stringify({ version: 1, id, createdAt: Date.now(), raw }), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const saved = readLegacyArchive(id);
  if (saved?.raw !== raw) throw new Error("The saved chat archive could not be verified. Your browser copy is unchanged.");
  return { id, createdAt: saved.createdAt };
}

export function readLegacyArchive(id: string): { version: 1; id: string; createdAt: number; raw: string } | null {
  if (!ID.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(directory(), `${id}.json`), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function listLegacyArchives() {
  let files: string[];
  try { files = fs.readdirSync(directory()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return files.filter((file) => ID.test(file.replace(/\.json$/, ""))).map((file) => readLegacyArchive(file.replace(/\.json$/, "")))
    .filter((archive) => archive !== null).map(({ id, createdAt, raw }) => ({ id, createdAt, bytes: Buffer.byteLength(raw) }));
}
