import { describe, expect, it } from "vitest";

import { removeQueuedItem, replaceQueuedItem } from "./chat-input-queue";

const pending = {
  steering: ["steer-a", "steer-b"],
  followUp: ["later-a", "later-b"],
};

describe("queued prompt edits", () => {
  it("replaces a follow-up by index", () => {
    expect(replaceQueuedItem(pending, "followUp", 1, "edited")).toEqual({
      steering: ["steer-a", "steer-b"],
      followUp: ["later-a", "edited"],
    });
  });

  it("replaces a steering line by index", () => {
    expect(replaceQueuedItem(pending, "steering", 0, "new steer")).toEqual({
      steering: ["new steer", "steer-b"],
      followUp: ["later-a", "later-b"],
    });
  });

  it("returns the same pending prompt when the index is out of range", () => {
    expect(replaceQueuedItem(pending, "followUp", 4, "nope")).toBe(pending);
    expect(removeQueuedItem(pending, "steering", -1)).toBe(pending);
  });

  it("removes a line without touching the other kind", () => {
    expect(removeQueuedItem(pending, "followUp", 0)).toEqual({
      steering: ["steer-a", "steer-b"],
      followUp: ["later-b"],
    });
  });
});
