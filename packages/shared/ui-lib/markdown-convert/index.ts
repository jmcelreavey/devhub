/** Re-export shared implementation (MCP + dashboard source of truth lives in shared/). */
export {
  blocksToPortableMarkdown,
  blocksToText,
  textToBlocks,
} from "../../markdown-convert/index.ts";
export type { BlocksToTextOptions } from "../../markdown-convert/index.ts";
