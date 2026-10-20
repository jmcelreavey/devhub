import { describe, expect, it } from "vitest";
import { parseCursorModelList } from "./cursor-models";

describe("parseCursorModelList", () => {
  it("reads ids from cursor-agent --list-models output", () => {
    expect(parseCursorModelList(`
Available models

grok-4.7-low - Grok 4.7 Low
composer-2.5 - Composer 2.5 (current)
gpt-5.6-sol-high-fast - GPT-5.6 Sol High Fast

Tip: use --model <id>
`)).toEqual(["grok-4.7-low", "composer-2.5", "gpt-5.6-sol-high-fast"]);
  });
});
