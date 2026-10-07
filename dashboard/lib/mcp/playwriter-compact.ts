/**
 * Stdio proxy in front of `npx playwriter@latest`.
 *
 * Playwriter registers `execute` with dist/prompt.md (~53KB) as the tool
 * description. Cursor then drops execute/reset even when the server is
 * connected (resources still list). Truncate that description and point at
 * Playwriter's MCP resources instead.
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export const PLAYWRITER_EXECUTE_DESCRIPTION = [
  "Run Playwright JS in the connected Chrome tab (Playwriter extension must be green on that tab).",
  "In scope: page, context, state, console. Keep snippets short; call execute again instead of one giant script.",
  "Full API lives on MCP resources debugger-api, editor-api, and styles-api. Call reset if the page/browser connection dies.",
].join(" ");

interface JsonRpcMessage {
  result?: { tools?: Array<{ name?: string; description?: string }> };
  [key: string]: unknown;
}

export function compactPlaywriterJsonRpc(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const msg = message as JsonRpcMessage;
  const tools = msg.result?.tools;
  if (!Array.isArray(tools)) return message;
  return {
    ...msg,
    result: {
      ...msg.result,
      tools: tools.map((tool) => {
        if (tool?.name !== "execute" || typeof tool.description !== "string")
          return tool;
        if (tool.description.length <= PLAYWRITER_EXECUTE_DESCRIPTION.length)
          return tool;
        return { ...tool, description: PLAYWRITER_EXECUTE_DESCRIPTION };
      }),
    },
  };
}

/**
 * MCP's stdio transport is newline-delimited JSON — one message per line, no
 * LSP-style Content-Length headers. Waiting for headers here swallowed every
 * reply, so clients sat until their startup timeout (30–60s) and dropped it.
 */
export function createStdoutParser(
  onMessage: (message: unknown) => void,
): (chunk: Buffer) => void {
  let buf = "";
  const decoder = new StringDecoder("utf8");
  return (chunk: Buffer) => {
    buf += decoder.write(chunk);
    let newline: number;
    while ((newline = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, newline).trim();
      buf = buf.slice(newline + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line) as unknown);
      } catch (err) {
        process.stderr.write(
          `playwriter-compact: skipped malformed JSON-RPC (${String(err)})\n`,
        );
      }
    }
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(
    entry && entry.replaceAll("\\", "/").includes("playwriter-compact"),
  );
}

function main(): void {
  const child = spawn("npx", ["-y", "playwriter@latest"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });

  process.stdin.on("data", (chunk: Buffer) => {
    child.stdin.write(chunk);
  });
  process.stdin.on("end", () => {
    child.stdin.end();
  });

  const parse = createStdoutParser((message) => {
    process.stdout.write(`${JSON.stringify(compactPlaywriterJsonRpc(message))}\n`);
  });
  child.stdout.on("data", parse);

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

if (isDirectRun()) main();
