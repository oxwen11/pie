import { describe, expect, it } from "vitest";

import {
  promoteQueuedFollowUp,
  queuedPromptKey,
  removeQueuedItem,
  replaceQueuedItem,
} from "./chat-input-queue-model";

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

  it("removes a line without touching the other kind", () => {
    expect(removeQueuedItem(pending, "followUp", 0)).toEqual({
      steering: ["steer-a", "steer-b"],
      followUp: ["later-b"],
    });
  });

  it("keeps other follow-ups when promoting the first line", () => {
    expect(promoteQueuedFollowUp(pending, 0)).toEqual({
      steering: ["steer-a", "steer-b", "later-a"],
      followUp: ["later-b"],
    });
  });

  it("keys duplicate queued texts by occurrence", () => {
    const items = ["same", "other", "same"];
    expect(queuedPromptKey("followUp", items, 0)).toBe("followUp:same:0");
    expect(queuedPromptKey("followUp", items, 2)).toBe("followUp:same:1");
  });
});
