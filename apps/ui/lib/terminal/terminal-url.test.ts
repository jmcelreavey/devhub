import { expect, it } from "vitest";
import { resolveTerminalUrl } from "./terminal-url";

it("uses a configured WebSocket URL or the current host and terminal port", () => {
  const params = new URLSearchParams({ session: "new", cwd: "/workspace" });
  const http = { protocol: "http:", hostname: "localhost" };
  const https = { protocol: "https:", hostname: "devhub.example" };

  expect(resolveTerminalUrl(undefined, http, "1439", params))
    .toBe("ws://localhost:1439/?session=new&cwd=%2Fworkspace");
  expect(resolveTerminalUrl(" ", https, "1439", params))
    .toBe("wss://devhub.example:1439/?session=new&cwd=%2Fworkspace");
  expect(resolveTerminalUrl("ws://terminal.example:9000/pty?session=old&token=abc", http, "1439", params))
    .toBe("ws://terminal.example:9000/pty?session=new&token=abc&cwd=%2Fworkspace");
  expect(resolveTerminalUrl("wss://terminal.example/pty?token=abc", https, "1439", params))
    .toBe("wss://terminal.example/pty?token=abc&session=new&cwd=%2Fworkspace");
  expect(resolveTerminalUrl(null, http, "1439", params, "local-ticket"))
    .toBe("ws://localhost:1439/?session=new&cwd=%2Fworkspace&ticket=local-ticket");
  expect(resolveTerminalUrl("ws://127.0.0.1:1439/pty", http, "9999", params, "local-ticket", 1439))
    .toBe("ws://127.0.0.1:1439/pty?session=new&cwd=%2Fworkspace&ticket=local-ticket");
  expect(resolveTerminalUrl("ws://localhost:9999/pty", http, "9999", params, "local-ticket", 1439))
    .toBe("ws://localhost:9999/pty?session=new&cwd=%2Fworkspace");
  expect(resolveTerminalUrl("wss://terminal.example/pty?ticket=remote-ticket", http, "1439", params, "local-ticket", 1439))
    .toBe("wss://terminal.example/pty?ticket=remote-ticket&session=new&cwd=%2Fworkspace");

  for (const invalid of ["https://terminal.example", "ws://terminal.example/#", "ws://terminal.example/#fragment", "ws:terminal.example"]) {
    expect(() => resolveTerminalUrl(invalid, http, "1439", params))
      .toThrow("Invalid terminal URL configuration");
  }
});
