export { type TreeEntry } from "@/lib/vault/vault-storage";

import { jsonVaultCodec } from "@/lib/vault/vault-codec";
import { VaultStorage } from "@/lib/vault/vault-storage";

/** Notes vault storage (BlockNote JSON). Subclass preserves legacy `new NotesStorage(dir)` call sites. */
export class NotesStorage extends VaultStorage {
  constructor(rootDir: string) {
    super(rootDir, jsonVaultCodec);
  }

  search(query: string) {
    return super.search(query, { includeTldraw: true });
  }

  getAllNoteFiles(): string[] {
    return this.getAllVaultFiles();
  }
}
