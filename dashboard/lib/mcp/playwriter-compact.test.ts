import { describe, expect, it } from "vitest";
import {
  compactPlaywriterJsonRpc,
  PLAYWRITER_EXECUTE_DESCRIPTION,
} from "./playwriter-compact";

describe("compactPlaywriterJsonRpc", () => {
  it("replaces a bloated execute description and leaves reset alone", () => {
    const bloated = "x".repeat(50_000);
    const out = compactPlaywriterJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "execute",
            description: bloated,
            inputSchema: { type: "object" },
          },
          { name: "reset", description: "Recreates the CDP connection." },
        ],
      },
    }) as {
      result: {
        tools: Array<{
          name: string;
          description: string;
          inputSchema?: unknown;
        }>;
      };
    };

    expect(out.result.tools[0]?.description).toBe(
      PLAYWRITER_EXECUTE_DESCRIPTION,
    );
    expect(out.result.tools[0]?.description.length).toBeLessThan(600);
    expect(out.result.tools[0]?.inputSchema).toEqual({ type: "object" });
    expect(out.result.tools[1]?.description).toBe(
      "Recreates the CDP connection.",
    );
  });

  it("passes through messages that are not tools/list results", () => {
    const ping = { jsonrpc: "2.0", id: 2, result: { ok: true } };
    expect(compactPlaywriterJsonRpc(ping)).toEqual(ping);
  });
});
