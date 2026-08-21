import { describe, expect, it } from "vitest";
import { formatJiraTicket } from "./work.ts";

describe("formatJiraTicket", () => {
  it("formats the status object returned by the Jira ticket endpoint", () => {
    expect(
      formatJiraTicket({
        key: "PTF-3896",
        status: { name: "Discovery" },
        issuetype: "Epic",
        summary: "Job Search Agent Discovery",
      }),
    ).toBe("PTF-3896 [Discovery] (Epic)\nJob Search Agent Discovery");
  });
});
