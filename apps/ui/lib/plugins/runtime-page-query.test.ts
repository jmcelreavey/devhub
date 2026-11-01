import { expect, it } from "vitest";
import { runtimePageQuery } from "./runtime-page-query";

it("passes the first value of each query key while reserving page", () => {
  expect(runtimePageQuery("?page=%2Fanswer&token=first&token=second&empty=&__proto__=safe")).toEqual({
    token: "first", empty: "", ["__proto__"]: "safe",
  });
});

it("rejects an oversized query rather than passing partial input", () => {
  expect(runtimePageQuery(`?token=${"a".repeat(4096)}`)).toBeNull();
  expect(runtimePageQuery("")).toEqual({});
});
