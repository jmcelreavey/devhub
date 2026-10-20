import { describe, expect, it } from "vitest";
import { isAcknowledgement, normalizeSlackCommand, unescapeSlackText } from "./slack-text";

describe("normalizeSlackCommand", () => {
  it.each([
    ["<@UBOT> prs", "prs"], ["  <@UBOT|devhub> meetings today", "meetings today"],
    ["<@UBOT> <@UBOT> help", "<@UBOT> help"], ["<@UOTHER> prs", "<@UOTHER> prs"],
    ["ask <@UBOT> for help", "ask <@UBOT> for help"],
  ])("removes only one leading mention of this bot: %s", (input, expected) => {
    expect(normalizeSlackCommand(input, "UBOT")).toBe(expected);
  });
});

describe("unescapeSlackText", () => {
  it("turns entities back into the characters that were typed", () => {
    expect(unescapeSlackText("a &lt;b&gt; &amp; c")).toBe("a <b> & c");
    expect(unescapeSlackText("&amp;lt;")).toBe("&lt;");
  });
  it("shows mentions as @name, or @id when Slack gave no name", () => {
    expect(unescapeSlackText("ask <@U123ABC|sam> and <@U999>")).toBe("ask @sam and @U999");
    expect(unescapeSlackText("<!here> see <#C123|deploys>")).toBe("@here see #deploys");
  });
  it("shows links as text (url), or the bare url", () => {
    expect(unescapeSlackText("see <https://example.com/a?b=1&amp;c=2|the doc>")).toBe("see the doc (https://example.com/a?b=1&c=2)");
    expect(unescapeSlackText("see <https://example.com/x>")).toBe("see https://example.com/x");
    expect(unescapeSlackText("<https://example.com|https://example.com>")).toBe("https://example.com");
    expect(unescapeSlackText("mail <mailto:a@b.co|Sam>")).toBe("mail Sam (a@b.co)");
  });
  it("leaves plain text alone", () => expect(unescapeSlackText("use the staging repo")).toBe("use the staging repo"));
});

describe("isAcknowledgement", () => {
  it.each(["thanks", "Thanks!", "thank you", "Thank you so much", "ok", "OK.", "okay", "ty", "cheers", "nice", "great", "ok thanks", "great, thanks", "👍", "🙏🙏", ":thumbsup:", ":white_check_mark: 👍"])(
    "%j is an acknowledgement", (text) => expect(isAcknowledgement(text)).toBe(true),
  );
  it.each(["use the staging repo", "ok but which repo?", "thanks, now deploy PTF-1", "great idea, please add retries and log them", "42", "yes", "", "<https://example.com>"])(
    "%j is a real message", (text) => expect(isAcknowledgement(text)).toBe(false),
  );
});
