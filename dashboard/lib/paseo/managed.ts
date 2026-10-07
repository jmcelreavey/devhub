import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withMutex } from "@/lib/atomic-write";
import { resolveBackgroundCli } from "./launch";

/** Written by scripts/install-paseo.mjs; DevHub adds only `defaultProvider`. */
const manifestSchema = z.object({
  root: z.string(), home: z.string(), version: z.string(), url: z.string(), web: z.string(),
  defaultProvider: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
}).passthrough();
export type PaseoManaged = z.infer<typeof manifestSchema>;

export const PASEO_DAEMON_LABEL = "devhub.paseo.daemon";
/** The Linux (systemd --user) unit; keep in step with scripts/paseo-service.mjs. */
export const PASEO_SYSTEMD_UNIT = "devhub-paseo.service";

export function paseoManifestFile(): string {
  return path.join(os.homedir(), ".config", "devhub", "paseo-managed.json");
}

export function readPaseoManaged(): PaseoManaged | null {
  let raw: string;
  try { raw = fs.readFileSync(paseoManifestFile(), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Cannot read the managed Paseo manifest.");
  }
  const parsed = manifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("The managed Paseo manifest is invalid. Run setup again.");
  return parsed.data;
}

function writeAtomic(file: string, value: unknown): void {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

/** Connection tab choice, else DEVHUB_AGENT_CLI. */
export function preferredPaseoProvider(): string {
  try { return readPaseoManaged()?.defaultProvider ?? resolveBackgroundCli(); } catch { return resolveBackgroundCli(); }
}

export async function setDefaultPaseoProvider(provider: string): Promise<void> {
  await withMutex(paseoManifestFile(), async () => {
    const managed = readPaseoManaged();
    if (!managed) throw new Error("Set up managed Paseo first.");
    writeAtomic(paseoManifestFile(), manifestSchema.parse({ ...managed, defaultProvider: provider }));
  });
}

function configFile(managed: PaseoManaged): string {
  return path.join(managed.home, "config.json");
}

export function paseoRelayEnabled(managed: PaseoManaged): boolean {
  try { return JSON.parse(fs.readFileSync(configFile(managed), "utf8"))?.daemon?.relay?.enabled === true; } catch { return false; }
}

/** Phone access off: the daemon stops dialling the relay after its restart. Pairing turns it back on. */
export async function disablePaseoRelay(managed: PaseoManaged): Promise<void> {
  await withMutex(configFile(managed), async () => {
    const current = JSON.parse(fs.readFileSync(configFile(managed), "utf8"));
    writeAtomic(configFile(managed), { ...current, daemon: { ...current.daemon, relay: { ...current.daemon?.relay, enabled: false } } });
  });
}

export function paseoCli(managed: PaseoManaged): string {
  return path.join(managed.root, "node_modules", "@getpaseo", "cli", "bin", "paseo");
}
