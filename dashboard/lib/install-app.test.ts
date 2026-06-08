import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { placeArtifact, resolveBuiltArtifact } from "./install-app.ts";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhub-install-app-"));
}

describe("resolveBuiltArtifact", () => {
  it("picks the AppImage on linux", () => {
    const release = makeTmp();
    fs.writeFileSync(path.join(release, "DevHub-1.0.0.AppImage"), "binary");
    fs.writeFileSync(path.join(release, "DevHub-1.0.0.deb"), "ignored");
    const artifact = resolveBuiltArtifact(release, "linux");
    expect(artifact).toEqual({
      kind: "appimage",
      src: path.join(release, "DevHub-1.0.0.AppImage"),
    });
    fs.rmSync(release, { recursive: true, force: true });
  });

  it("picks the unpacked .app on darwin", () => {
    const release = makeTmp();
    const app = path.join(release, "mac-arm64", "DevHub.app");
    fs.mkdirSync(app, { recursive: true });
    const artifact = resolveBuiltArtifact(release, "darwin");
    expect(artifact).toEqual({ kind: "app", src: app });
    fs.rmSync(release, { recursive: true, force: true });
  });

  it("returns null when nothing built", () => {
    const release = makeTmp();
    expect(resolveBuiltArtifact(release, "linux")).toBeNull();
    expect(resolveBuiltArtifact(release, "darwin")).toBeNull();
    fs.rmSync(release, { recursive: true, force: true });
  });
});

describe("placeArtifact (linux)", () => {
  it("copies the AppImage, marks it executable, installs the icon, and writes a .desktop launcher", () => {
    const release = makeTmp();
    const home = makeTmp();
    const src = path.join(release, "DevHub-1.0.0.AppImage");
    fs.writeFileSync(src, "binary");
    const iconSource = path.join(release, "icon-512.png");
    fs.writeFileSync(iconSource, "png");

    const dest = placeArtifact({ kind: "appimage", src }, home, "linux", iconSource);

    expect(dest).toBe(path.join(home, "Applications", "DevHub.AppImage"));
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).mode & 0o111).toBeTruthy(); // executable bit set

    // Icon goes into the hicolor theme, referenced by bare name (Icon=devhub),
    // because WSLg's Start Menu icon conversion resolves names via the theme,
    // not absolute paths.
    const iconDest = path.join(
      home, ".local", "share", "icons", "hicolor", "512x512", "apps", "devhub.png",
    );
    expect(fs.existsSync(iconDest)).toBe(true);

    const desktop = fs.readFileSync(
      path.join(home, ".local", "share", "applications", "devhub.desktop"),
      "utf-8",
    );
    expect(desktop).toContain("Name=DevHub");
    expect(desktop).toContain(`Exec=${dest}`);
    expect(desktop).toMatch(/^Icon=devhub$/m);
    expect(desktop).toContain("StartupWMClass=DevHub");

    fs.rmSync(release, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("omits the Icon line when no source icon exists", () => {
    const release = makeTmp();
    const home = makeTmp();
    const src = path.join(release, "DevHub-1.0.0.AppImage");
    fs.writeFileSync(src, "binary");

    placeArtifact({ kind: "appimage", src }, home, "linux", path.join(release, "missing.png"));

    const desktop = fs.readFileSync(
      path.join(home, ".local", "share", "applications", "devhub.desktop"),
      "utf-8",
    );
    expect(desktop).not.toContain("Icon=");

    fs.rmSync(release, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });
});
