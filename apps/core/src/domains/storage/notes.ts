export { type TreeEntry } from "./vault.ts";

import { jsonVaultCodec } from "../../../../../packages/shared/vault/vault-codec.ts";
import { VaultStorage } from "./vault.ts";

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
