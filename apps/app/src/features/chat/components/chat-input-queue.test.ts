import { describe, expect, it } from "vitest";

import { promoteQueuedFollowUp, removeQueuedItem, replaceQueuedItem } from "./chat-input-queue";

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

  it("promotes a follow-up onto the end of steering", () => {
    expect(promoteQueuedFollowUp(pending, 1)).toEqual({
      steering: ["steer-a", "steer-b", "later-b"],
      followUp: ["later-a"],
    });
  });

  it("returns the same pending prompt when the follow-up index is out of range", () => {
    expect(promoteQueuedFollowUp(pending, -1)).toBe(pending);
    expect(promoteQueuedFollowUp(pending, 2)).toBe(pending);
  });

  it("keeps other follow-ups when promoting the first line", () => {
    expect(promoteQueuedFollowUp(pending, 0)).toEqual({
      steering: ["steer-a", "steer-b", "later-a"],
      followUp: ["later-b"],
    });
  });
});
