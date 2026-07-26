import { describe, expect, it } from "vitest";
import { tutorMessageText } from "@/lib/repos/learn-tutor-utils";

describe("tutor route helpers", () => {
  it("extracts text from string content", () => {
    expect(tutorMessageText("hello")).toBe("hello");
  });

  it("extracts text from part arrays", () => {
    expect(tutorMessageText([{ type: "text", text: "gap" }])).toBe("gap");
  });
});
