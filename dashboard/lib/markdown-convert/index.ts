/** Re-export shared implementation (MCP + dashboard source of truth lives in shared/). */
export {
  blocksToPortableMarkdown,
  blocksToText,
  textToBlocks,
} from "../../../shared/markdown-convert/index.ts";
export type { BlocksToTextOptions } from "../../../shared/markdown-convert/index.ts";
