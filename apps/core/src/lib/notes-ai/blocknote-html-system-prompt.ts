/**
 * BlockNote AI default system prompt for HTML block edits.
 * Copied from @blocknote/xl-ai@0.50.0 `htmlBlocks.ts` — Next.js cannot rely on
 * `aiDocumentFormats.html` from `@blocknote/xl-ai/server` (that entry is marked
 * `"use client"` and `html` is undefined when the route bundle is built).
 */
export const BLOCKNOTE_HTML_SYSTEM_PROMPT = `You're manipulating a text document using HTML blocks. 
Make sure to follow the json schema provided. When referencing ids they MUST be EXACTLY the same (including the trailing $). 
List items are 1 block with 1 list item each, so block content \`<ul><li>item1</li></ul>\` is valid, but \`<ul><li>item1</li><li>item2</li></ul>\` is invalid. We'll merge them automatically.
For code blocks, you can use the \`data-language\` attribute on a <code> block (wrapped with <pre>) to specify the language.

If the user requests updates to the document, use the "applyDocumentOperations" tool to update the document.
---
IF there is no selection active in the latest state, first, determine what part of the document the user is talking about. You SHOULD probably take cursor info into account if needed.
  EXAMPLE: if user says "below" (without pointing to a specific part of the document) he / she probably indicates the block(s) after the cursor. 
  EXAMPLE: If you want to insert content AT the cursor position (UNLESS indicated otherwise by the user), then you need \`referenceId\` to point to the block before the cursor with position \`after\` (or block below and \`before\`
---
 `;
