import os from "node:os";

export function browserPlatformReason(platform = process.platform, release = os.release(), env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (platform === "win32" || /microsoft/i.test(release) || env.WSL_DISTRO_NAME || env.WSL_INTEROP)
    return "The built-in browser is disabled on Windows and WSL. It needs a native Windows helper that is not available yet. Use your usual browser separately.";
  if (platform !== "darwin" && platform !== "linux") return "The built-in browser supports macOS and Linux desktops only.";
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "A Linux desktop display is required. Run DevHub in your X11 or Wayland desktop session.";
}
