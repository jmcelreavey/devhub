import { describe, expect, it } from "vitest";
import { resolveSetupPath, windowsPathToWsl } from "./input-path";

describe("windowsPathToWsl", () => {
  it("maps drive paths onto /mnt", () => {
    expect(windowsPathToWsl("C:\\Users\\me\\code")).toBe("/mnt/c/Users/me/code");
    expect(windowsPathToWsl("d:\\")).toBe("/mnt/d");
    expect(windowsPathToWsl("C:\\x\\")).toBe("/mnt/c/x");
    expect(windowsPathToWsl("C:/Users/me")).toBe("/mnt/c/Users/me");
    expect(windowsPathToWsl("\\\\?\\C:\\Program Files\\DevHub")).toBe("/mnt/c/Program Files/DevHub");
  });

  it("maps the distro share back to a Linux path", () => {
    expect(windowsPathToWsl("\\\\wsl.localhost\\Ubuntu\\home\\me\\dev")).toBe("/home/me/dev");
    expect(windowsPathToWsl("\\\\wsl$\\Ubuntu\\home\\me")).toBe("/home/me");
    expect(windowsPathToWsl("\\\\WSL.LOCALHOST\\Ubuntu")).toBe("/");
  });

  it("rejects shapes with no Linux equivalent", () => {
    expect(windowsPathToWsl("\\\\fileserver\\share\\x")).toBeNull();
    expect(windowsPathToWsl("relative\\path")).toBeNull();
    expect(windowsPathToWsl("/home/me")).toBeNull();
    expect(windowsPathToWsl("")).toBeNull();
  });
});

describe("resolveSetupPath", () => {
  const wsl = { home: "/home/me", wsl: true };
  const mac = { home: "/Users/me", wsl: false };

  it("expands the home directory", () => {
    expect(resolveSetupPath("~", wsl)).toBe("/home/me");
    expect(resolveSetupPath("~/dev", wsl)).toBe("/home/me/dev");
    expect(resolveSetupPath("  ~/code  ", mac)).toBe("/Users/me/code");
  });

  it("translates Windows notation only inside WSL", () => {
    expect(resolveSetupPath("C:\\Users\\me\\code", wsl)).toBe("/mnt/c/Users/me/code");
    expect(resolveSetupPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\dev", wsl)).toBe("/home/me/dev");
    expect(resolveSetupPath("C:\\Users\\me\\code", mac)).toBe("C:\\Users\\me\\code");
  });

  it("leaves Linux paths alone and relative input unresolved", () => {
    expect(resolveSetupPath("/home/me/dev/", wsl)).toBe("/home/me/dev");
    expect(resolveSetupPath("dev", wsl)).toBe("dev");
    expect(resolveSetupPath("", wsl)).toBe("");
  });
});
