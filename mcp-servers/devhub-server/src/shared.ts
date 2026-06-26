/**
 * Re-exports of the repo's shared vault helpers, kept at `src/` depth so the
 * tool modules under `src/tools/` import from a single sibling instead of
 * reaching `../../../../shared/...`.
 */
export {
  VaultStorage,
  flattenTree,
  markdownVaultCodec,
  resolveContentDir,
  type TreeEntry,
} from "../../../shared/vault/index.ts";
