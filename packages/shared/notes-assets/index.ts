/** Shared notes-assets — source of truth for dashboard and notes MCP. */
export {
  NOTES_ASSETS_API_PREFIX,
  imageMarkdownLine,
  isExternalMediaUrl,
  isVideoMediaPath,
  normalizeNoteAssetRelPath,
  parseImageMarkdownLine,
  toNoteAssetApiUrl,
  toNoteAssetMarkdownPath,
} from './markdown.ts';

export {
  ALLOWED_NOTE_ASSET_EXTENSIONS,
  IMPORT_LOCAL_ASSET_MAX_BYTES,
  assertNoteAssetRelPath,
  contentTypeForAssetExtension,
  contentTypeForAssetPath,
  importLocalAsset,
  isAllowedNoteAssetExtension,
  readNoteAssetBytes,
  resolveNoteAssetUnderRoot,
  writeNoteAssetBytes,
} from './server.ts';
