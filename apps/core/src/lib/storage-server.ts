import type { NotesStorage } from "../domains/storage/notes";
import { getVaultStorage } from "./vault/vault-registry";

/** Singleton notes vault (BlockNote JSON) — same instance as {@link getVaultStorage}("notes"). */
export function getStorage(): NotesStorage {
  return getVaultStorage("notes");
}
