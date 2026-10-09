import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = join(__dirname, "../public");
const appDir = join(__dirname, "../app");

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("Shift Dock favicon", () => {
  it("keeps a crisp 16px png for each colour scheme", () => {
    for (const name of ["favicon-16.png", "favicon-16-light.png"]) {
      const { width, height } = pngSize(readFileSync(join(publicDir, name)));
      expect(width).toBe(16);
      expect(height).toBe(16);
    }
    const doubled = pngSize(readFileSync(join(publicDir, "icon-32.png")));
    expect(doubled).toEqual({ width: 32, height: 32 });
  });

  it("follows the browser scheme from one svg, and does not let Next inject a single-palette ico", () => {
    const svg = readFileSync(join(publicDir, "favicon.svg"), "utf8");
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg).toContain("#46545f");
    expect(svg).toContain("#9aa6b2");
    expect(svg).toContain("#4c840c");
    expect(svg).toContain("#9ed84a");
    expect(svg).toContain("#669826");
    expect(svg).toContain("#5f8f2f");
    expect(existsSync(join(appDir, "favicon.ico"))).toBe(false);
    expect(existsSync(join(publicDir, "favicon.ico"))).toBe(true);
    const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");
    expect(layout).toContain('url: "/favicon.svg"');
    expect(layout).not.toContain("shortcut:");
  });
});
