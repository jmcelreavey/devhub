import { describe, expect, it } from "vitest";
import type { TreeEntry } from "@/lib/vault/vault-storage";
import {
  buildVaultIndexSummary,
  stripVaultExtension,
} from "@/lib/vault/vault-index-summary";

const pageHref = (slug: string) => `/docs/${slug.split("/").map(encodeURIComponent).join("/")}`;

describe("stripVaultExtension", () => {
  it("strips .md case-insensitively", () => {
    expect(stripVaultExtension("README.md", ".md")).toBe("README");
    expect(stripVaultExtension("guide.MD", ".md")).toBe("guide");
  });

  it("strips .json", () => {
    expect(stripVaultExtension("daily.json", ".json")).toBe("daily");
  });
});

describe("buildVaultIndexSummary", () => {
  const tree: TreeEntry[] = [
    { type: "file", name: "README.md", path: "README.md", modified: 100 },
    {
      type: "dir",
      name: "guides",
      path: "guides",
      children: [
        {
          type: "file",
          name: "install.md",
          path: "guides/install.md",
          modified: 300,
        },
        {
          type: "dir",
          name: "advanced",
          path: "guides/advanced",
          children: [
            {
              type: "file",
              name: "tips.md",
              path: "guides/advanced/tips.md",
              modified: 200,
            },
          ],
        },
      ],
    },
  ];

  it("counts nested files and builds folder sections", () => {
    const summary = buildVaultIndexSummary(tree, {
      extension: ".md",
      pageHref,
    });

    expect(summary.totalFiles).toBe(3);
    expect(summary.rootFiles).toHaveLength(1);
    expect(summary.rootFiles[0].label).toBe("README");
    expect(summary.folders).toHaveLength(1);
    expect(summary.folders[0].name).toBe("guides");
    expect(summary.folders[0].files[0].slug).toBe("guides/install");
    expect(summary.folders[0].children[0].files[0].slug).toBe("guides/advanced/tips");
  });

  it("orders recent by modified descending", () => {
    const summary = buildVaultIndexSummary(tree, {
      extension: ".md",
      pageHref,
      maxRecent: 2,
    });

    expect(summary.recent).toHaveLength(2);
    expect(summary.recent[0].slug).toBe("guides/install");
    expect(summary.recent[1].slug).toBe("guides/advanced/tips");
  });

  it("returns empty summary for empty tree", () => {
    const summary = buildVaultIndexSummary([], {
      extension: ".md",
      pageHref,
    });
    expect(summary.totalFiles).toBe(0);
    expect(summary.recent).toEqual([]);
  });
});
