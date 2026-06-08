export { writeAtomicNow } from "./atomic-write.ts";
export { jsonVaultCodec, markdownVaultCodec, type VaultCodec } from "./vault-codec.ts";
export {
  createVaultPathHelpers,
  type VaultPathConfig,
  type VaultPathHelpers,
} from "./vault-path.ts";
export {
  normalizeRelativePath,
  parentDir,
  joinRelative,
  stripExtension,
} from "./relative-path.ts";
export { flattenTree } from "./tree.ts";
export {
  VaultStorage,
  searchTextFiles,
  type TreeEntry,
  type VaultFileResult,
  type TextSearchResult,
} from "./vault-storage.ts";
export { resolveContentDir } from "./content-dirs.ts";
export { VAULT_PATHS, type VaultId } from "./vault-routes.ts";
