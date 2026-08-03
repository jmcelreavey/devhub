import { createHash } from "node:crypto";
import { blocksToPortableMarkdown, blocksToText } from "@/lib/markdown-convert";
import {
  firstHeadingFromMarkdown,
  titleFromDocMarkdown,
  vaultDisplayTitle,
} from "@/lib/vault/display-title";
import { getVaultStorage } from "@/lib/vault/vault-registry";
import { listShares } from "@/lib/share/share-store";
import type { ShareStatus, VaultId } from "@/lib/share/share-public";

export interface ShareSource {
  title: string;
  markdown: string;
}

/** Resolve a vault note/doc to the markdown we would publish, or null if gone. */
export function readShareSource(vault: VaultId, sharePath: string): ShareSource | null {
  const file = getVaultStorage(vault).read(sharePath);
  if (!file) return null;
  const fileName = sharePath.split("/").pop() ?? sharePath;

  if (vault === "docs") {
    const markdown = typeof file.content === "string" ? file.content : "";
    const { displayTitle } = vaultDisplayTitle(fileName, titleFromDocMarkdown(markdown));
    return { title: displayTitle, markdown };
  }

  const blocks = Array.isArray(file.content) ? file.content : [];
  // Round-trip markdown is for DevHub; gists need portable GitHub markdown.
  const markdown = blocksToPortableMarkdown(blocks);
  const contentTitle = firstHeadingFromMarkdown(blocksToText(blocks));
  const { displayTitle } = vaultDisplayTitle(fileName, contentTitle);
  return { title: displayTitle, markdown };
}

/** Stable fingerprint of published markdown, used to detect drift. */
export function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

/** Every live share annotated with live drift status (stale / missing source). */
export function listShareStatuses(): ShareStatus[] {
  return listShares().map((share) => {
    const source = readShareSource(share.vault, share.path);
    const missing = source === null;
    const stale = missing || hashMarkdown(source.markdown) !== share.contentHash;
    return { ...share, stale, missing };
  });
}

/** How many live shares have drifted from their source (for nav alerts). */
export function countStaleShares(): number {
  return listShareStatuses().filter((s) => s.stale).length;
}
