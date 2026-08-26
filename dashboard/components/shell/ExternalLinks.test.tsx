/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalLinks, externalHref } from "@/components/shell/ExternalLinks";

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("externalHref", () => {
  it("returns absolute http(s) urls outside the dashboard origin", () => {
    const a = document.createElement("a");
    a.href = "https://github.com/acme/widgets/pull/1";
    document.body.append(a);
    expect(externalHref(a)).toBe("https://github.com/acme/widgets/pull/1");
    a.remove();
  });

  it("ignores same-origin links and non-http protocols", () => {
    const internal = document.createElement("a");
    internal.href = `${window.location.origin}/repos`;
    document.body.append(internal);
    expect(externalHref(internal)).toBeNull();

    const mail = document.createElement("a");
    mail.href = "mailto:dev@example.test";
    document.body.append(mail);
    expect(externalHref(mail)).toBeNull();

    const plain = document.createElement("span");
    document.body.append(plain);
    expect(externalHref(plain)).toBeNull();

    internal.remove();
    mail.remove();
    plain.remove();
  });
});

describe("ExternalLinks interception", () => {
  it("routes external anchor clicks through the desktop opener", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke },
    });
    document.body.innerHTML = '<a id="ext" href="https://example.test/x">x</a>';
    render(<ExternalLinks />);

    fireEvent.click(document.getElementById("ext")!);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
        url: "https://example.test/x",
      });
    });
  });

  it("leaves same-origin anchors alone in a browser (no Tauri bridge)", () => {
    document.body.innerHTML = `<a id="int" href="${window.location.origin}/repos">r</a>`;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ExternalLinks />);

    fireEvent.click(document.getElementById("int")!);
    expect(open).not.toHaveBeenCalled();
  });
});
