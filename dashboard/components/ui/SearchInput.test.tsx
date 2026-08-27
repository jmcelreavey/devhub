/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineSearch } from "@/components/ui/InlineSearch";
import { SearchInput } from "@/components/ui/SearchInput";

function expectNoAutocorrect(input: HTMLInputElement) {
  const html = input.outerHTML.toLowerCase();
  expect(html).toContain('autocomplete="off"');
  expect(html).toContain('autocorrect="off"');
  expect(html).toContain('autocapitalize="off"');
  expect(html).toContain('spellcheck="false"');
  expect(html).toContain('writingsuggestions="false"');
}

describe("search query inputs", () => {
  it("disable browser autocorrect so arrow keys navigate results", () => {
    const { unmount } = render(
      <SearchInput value="devhub" onChange={() => undefined} placeholder="Search repos" />,
    );
    expectNoAutocorrect(screen.getByRole("searchbox"));
    unmount();

    render(<InlineSearch id="q" label="Search tasks" value="devhub" onChange={() => undefined} />);
    expectNoAutocorrect(screen.getByRole("textbox"));
  });
});
