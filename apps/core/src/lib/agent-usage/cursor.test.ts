import { expect, it } from "vitest";
import { decryptCursorSafeStorage } from "./cursor";

it("decrypts Cursor's macOS safe-storage token and rejects malformed ciphertext", () => {
  const encrypted = "cursor-safe-storage:v1:djEwVqBVKQFfLA2rprw2GauhkT+m+vBOQT27lY0MdKQGJQ4=";

  expect(decryptCursorSafeStorage(encrypted, "fixture-password")).toBe("sample.access.token");
  expect(() => decryptCursorSafeStorage("cursor-safe-storage:v1:invalid", "fixture-password")).toThrow("Invalid Cursor token storage");
});
