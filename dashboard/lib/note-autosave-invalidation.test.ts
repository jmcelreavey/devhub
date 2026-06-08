import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NOTE_AUTOSAVE_INVALIDATE_EVENT,
  broadcastNoteAutosaveInvalidation,
  collectTreeNoteSlugs,
} from "./note-autosave-invalidation";

describe("broadcastNoteAutosaveInvalidation", () => {
  const postMessage = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { dispatchEvent } as unknown as Window);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage = postMessage;
        close = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches a window event with a normalized slug", () => {
    broadcastNoteAutosaveInvalidation("garden\\alpha");

    expect(dispatchEvent).toHaveBeenCalledOnce();
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ slug: string }>;
    expect(event.type).toBe(NOTE_AUTOSAVE_INVALIDATE_EVENT);
    expect(event.detail.slug).toBe("garden/alpha");
  });

  it("posts to the autosave BroadcastChannel", () => {
    broadcastNoteAutosaveInvalidation("daily/foo");

    expect(postMessage).toHaveBeenCalledWith({ slug: "daily/foo" });
  });

  it("normalizes diagram storage paths for cross-tab invalidation", () => {
    broadcastNoteAutosaveInvalidation("diagrams\\my-flow");

    expect(postMessage).toHaveBeenCalledWith({ slug: "diagrams/my-flow" });
  });
});

describe("collectTreeNoteSlugs", () => {
  it("collects file slugs from a folder subtree", () => {
    const slugs = collectTreeNoteSlugs(
      {
        type: "dir",
        path: "garden",
        children: [
          { type: "file", path: "garden/alpha.json" },
          {
            type: "dir",
            path: "garden/nested",
            children: [{ type: "file", path: "garden/nested/beta.json" }],
          },
        ],
      },
      (p) => p.replace(/\\/g, "/").replace(/\.json$/i, ""),
    );

    expect(slugs).toEqual(["garden/alpha", "garden/nested/beta"]);
  });
});
