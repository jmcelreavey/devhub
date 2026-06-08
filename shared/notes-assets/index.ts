/** Shared notes-assets — source of truth for dashboard and notes MCP. */
export {
  NOTES_ASSETS_API_PREFIX,
  imageMarkdownLine,
  normalizeNoteAssetRelPath,
  parseImageMarkdownLine,
  toNoteAssetApiUrl,
  toNoteAssetMarkdownPath,
} from './markdown.ts';

export {
  ALLOWED_NOTE_ASSET_EXTENSIONS,
  assertNoteAssetRelPath,
  contentTypeForAssetExtension,
  contentTypeForAssetPath,
  isAllowedNoteAssetExtension,
  readNoteAssetBytes,
  resolveNoteAssetUnderRoot,
  writeNoteAssetBytes,
} from './server.ts';
