import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyTreeSync, safeRemovePath } from "./server-utils";

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `devhub-${prefix}-`));
}

describe("safeRemovePath", () => {
  it("removes a regular directory", () => {
    const tmp = makeTmp("rm-dir");
    const target = path.join(tmp, "dir");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "file.txt"), "x");
    safeRemovePath(target);
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("removes a regular file", () => {
    const tmp = makeTmp("rm-file");
    const target = path.join(tmp, "file.txt");
    fs.writeFileSync(target, "x");
    safeRemovePath(target);
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("removes a broken symlink without error", () => {
    const tmp = makeTmp("rm-broken-link");
    const real = path.join(tmp, "real");
    const link = path.join(tmp, "link");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    fs.rmSync(real, { recursive: true });
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    safeRemovePath(link);
    expect(() => fs.lstatSync(link)).toThrow();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("removes a working symlink", () => {
    const tmp = makeTmp("rm-link");
    const real = path.join(tmp, "real");
    const link = path.join(tmp, "link");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    safeRemovePath(link);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(real)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not throw when path does not exist", () => {
    const tmp = makeTmp("rm-nope");
    expect(() => safeRemovePath(path.join(tmp, "nope"))).not.toThrow();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("copyTreeSync", () => {
  it("copies nested directories and files", () => {
    const tmp = makeTmp("copy-tree");
    const src = path.join(tmp, "src");
    const dst = path.join(tmp, "dst");
    fs.mkdirSync(path.join(src, "sub"), { recursive: true });
    fs.writeFileSync(path.join(src, "a.txt"), "a");
    fs.writeFileSync(path.join(src, "sub", "b.txt"), "b");
    copyTreeSync(src, dst);
    expect(fs.readFileSync(path.join(dst, "a.txt"), "utf-8")).toBe("a");
    expect(fs.readFileSync(path.join(dst, "sub", "b.txt"), "utf-8")).toBe("b");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
