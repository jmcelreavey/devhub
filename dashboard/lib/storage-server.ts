import type { NotesStorage } from "@/lib/storage";
import { getVaultStorage } from "@/lib/vault/vault-registry";

/** Singleton notes vault (BlockNote JSON) — same instance as {@link getVaultStorage}("notes"). */
export function getStorage(): NotesStorage {
  return getVaultStorage("notes");
}
