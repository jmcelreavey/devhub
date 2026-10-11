import { describe, it, expect } from "vitest";
import { publicAddress, siteOrigin, approvedUrl, StartBrowserSchema } from "./policy";
import { BrowserActionSchema } from "./types";
describe("browser site boundaries", () => {
  it("rejects privileged, local, credential and non-default-port origins", () => {
    for (const value of ["file:///etc/passwd", "chrome://settings", "http://example.com", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://api.internal", "https://example.com:1337", "https://a:b@example.com", "https://example.com/path"]) expect(() => siteOrigin(value)).toThrow();
    expect(siteOrigin("https://Example.com/")).toBe("https://example.com");
  });
  it("requires exact origins across navigation and redirects", () => {
    const approved = ["https://example.com"];
    expect(approvedUrl("https://example.com/page?a=1", approved)).toBe(true);
    for (const url of ["https://evil.example.com", "https://example.com.evil.org", "https://x@example.com", "file:///tmp/a", "https://localhost"]) expect(approvedUrl(url, approved)).toBe(false);
  });
  it("rejects private, mapped, metadata and reserved addresses", () => {
    for (const ip of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.2", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fd00::1", "2001:db8::1"]) expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true); expect(publicAddress("2606:4700::1111")).toBe(true);
  });
  it("requires consent and exposes no evaluation or cookie operations", () => {
    expect(StartBrowserSchema.safeParse({ taskId: "a", runId: "b", origins: ["https://example.com"] }).success).toBe(false);
    for (const kind of ["evaluate", "cookies", "upload", "cdp"]) expect(BrowserActionSchema.safeParse({ kind }).success).toBe(false);
  });
});
