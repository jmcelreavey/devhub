import { describe, expect, it } from "vitest";
import {
  contentTypeForDocAsset,
  docAssetSrc,
  resolveDocAssetPath,
  resolveDocAssets,
} from "./asset-src";

describe("resolveDocAssetPath", () => {
  it("resolves the real case that was broken", () => {
    // docs/guides/vendored-skills.md embeds ../assets/demos/*.gif. The browser
    // resolved that against the route (/docs/guides/…) and asked for
    // /docs/assets/…, which is a page route, so every demo was a broken image.
    expect(
      resolveDocAssetPath("../assets/demos/scope-creep-detector.gif", "guides/vendored-skills"),
    ).toBe("assets/demos/scope-creep-detector.gif");
  });

  it("resolves a sibling file", () => {
    expect(resolveDocAssetPath("diagram.png", "guides/theming")).toBe("guides/diagram.png");
  });

  it("resolves ./ the same as a bare name", () => {
    expect(resolveDocAssetPath("./diagram.png", "guides/theming")).toBe("guides/diagram.png");
  });

  it("handles a doc at the docs root", () => {
    expect(resolveDocAssetPath("assets/x.png", "README")).toBe("assets/x.png");
  });

  it("leaves absolute and external sources alone", () => {
    for (const src of [
      "/already/absolute.png",
      "https://example.com/x.png",
      "//example.com/x.png",
      "data:image/png;base64,AAAA",
    ]) {
      expect(resolveDocAssetPath(src, "guides/x"), src).toBeNull();
    }
  });

  it("refuses to escape the docs root", () => {
    // Returning null rather than clamping: a request that meant to escape
    // should fail visibly, not resolve to some other file.
    expect(resolveDocAssetPath("../../../.ssh/id_rsa", "guides/x")).toBeNull();
    expect(resolveDocAssetPath("../../secrets.png", "guides/x")).toBeNull();
  });

  it("allows traversal that stays inside the root", () => {
    expect(resolveDocAssetPath("../architecture/x.png", "guides/y")).toBe(
      "architecture/x.png",
    );
  });

  it("returns null for an empty or dot-only source", () => {
    expect(resolveDocAssetPath("", "guides/x")).toBeNull();
    expect(resolveDocAssetPath("./", "guides/x")).toBeNull();
  });
});

describe("docAssetSrc", () => {
  it("rewrites to the assets route", () => {
    expect(docAssetSrc("../assets/demos/a.gif", "guides/vendored-skills")).toBe(
      "/api/docs-assets/assets/demos/a.gif",
    );
  });

  it("percent-encodes each segment without mangling the separators", () => {
    expect(docAssetSrc("../assets/my demo.gif", "guides/x")).toBe(
      "/api/docs-assets/assets/my%20demo.gif",
    );
  });

  it("passes through an external image unchanged", () => {
    const src = "https://example.com/x.png";
    expect(docAssetSrc(src, "guides/x")).toBe(src);
  });

  it("passes through unchanged when the doc path is unknown", () => {
    // Keeps the renderer usable anywhere the slug is not available rather than
    // producing a URL that resolves to the wrong place.
    expect(docAssetSrc("../assets/x.gif", undefined)).toBe("../assets/x.gif");
  });
});

describe("contentTypeForDocAsset", () => {
  it("knows the demo formats", () => {
    expect(contentTypeForDocAsset("assets/demos/a.gif")).toBe("image/gif");
    expect(contentTypeForDocAsset("a.PNG")).toBe("image/png");
    expect(contentTypeForDocAsset("a.mp4")).toBe("video/mp4");
  });

  it("refuses anything not on the allowlist", () => {
    // The route uses this as a gate, so a doc cannot coax it into serving a
    // source file or a dotfile just by linking to one.
    expect(contentTypeForDocAsset("secrets.env")).toBeNull();
    expect(contentTypeForDocAsset("guides/x.md")).toBeNull();
    expect(contentTypeForDocAsset("noextension")).toBeNull();
  });
});

describe("resolveDocAssets", () => {
  it("rewrites images nested anywhere in the tree", () => {
    // Structural rather than typed against the node union: a walk that only
    // knew today's container types would silently miss an image added inside a
    // callout or table cell later.
    const tree = [
      { type: "paragraph", children: [{ type: "image", src: "../assets/a.gif", alt: "a" }] },
      { type: "callout", children: [{ type: "list", items: [[{ type: "image", src: "b.png" }]] }] },
    ];
    const out = resolveDocAssets(tree, "guides/x") as typeof tree;
    expect(JSON.stringify(out)).toContain("/api/docs-assets/assets/a.gif");
    expect(JSON.stringify(out)).toContain("/api/docs-assets/guides/b.png");
  });

  it("leaves non-image nodes untouched", () => {
    const tree = [{ type: "link", href: "../other", children: [] }];
    expect(resolveDocAssets(tree, "guides/x")).toEqual(tree);
  });

  it("is a no-op without a doc path", () => {
    const tree = [{ type: "image", src: "../assets/a.gif" }];
    expect(resolveDocAssets(tree, undefined)).toBe(tree);
  });

  it("does not mutate the input", () => {
    const tree = [{ type: "image", src: "../assets/a.gif" }];
    resolveDocAssets(tree, "guides/x");
    expect(tree[0].src).toBe("../assets/a.gif");
  });
});
