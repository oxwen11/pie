import { describe, expect, it } from "vitest";

import {
  formatWorkedFor,
  messageStartTimestampOf,
  splitWork,
  workedSeconds,
} from "./message-view.logic";

const text = (value: string) => ({ type: "text" as const, text: value });
const tool = (id: string) => ({
  type: "tool-read" as const,
  toolCallId: id,
  state: "output-available" as const,
  input: { path: "/tmp/a" },
  output: { content: [] as [], details: undefined },
});
const reasoning = { type: "reasoning" as const, text: "hm", state: "done" as const };

describe("splitWork", () => {
  it("keeps every part inside the wrapper while streaming", () => {
    expect(splitWork([text("hi"), tool("t1")], true)).toEqual({
      workParts: [text("hi"), tool("t1")],
      answerParts: [],
    });
  });

  it("returns null for an empty streaming message", () => {
    expect(splitWork([], true)).toBeNull();
  });

  it("returns null for a settled text-only turn", () => {
    expect(splitWork([text("hello")], false)).toBeNull();
  });

  it("peels the trailing answer off a settled turn with work", () => {
    expect(splitWork([text("looking"), tool("t1"), text("done")], false)).toEqual({
      workParts: [text("looking"), tool("t1")],
      answerParts: [text("done")],
    });
  });

  it("keeps everything inside when the last text is not at the tail", () => {
    expect(splitWork([text("looking"), tool("t1")], false)).toEqual({
      workParts: [text("looking"), tool("t1")],
      answerParts: [],
    });
  });

  it("folds a tools-only settled turn", () => {
    expect(splitWork([tool("t1"), reasoning], false)).toEqual({
      workParts: [tool("t1"), reasoning],
      answerParts: [],
    });
  });
});

describe("formatWorkedFor", () => {
  it("formats seconds and minutes", () => {
    expect(formatWorkedFor(0)).toBe("Worked for 0s");
    expect(formatWorkedFor(12)).toBe("Worked for 12s");
    expect(formatWorkedFor(60)).toBe("Worked for 1m");
    expect(formatWorkedFor(75)).toBe("Worked for 1m 15s");
  });
});

describe("workedSeconds", () => {
  it("is messageEndTimestamp minus messageStartTimestamp", () => {
    expect(
      workedSeconds({
        messageStartTimestamp: "2026-07-26T11:45:17.114Z",
        messageEndTimestamp: "2026-07-26T11:45:29.514Z",
      }),
    ).toBe(12);
    expect(messageStartTimestampOf({ messageStartTimestamp: "2026-07-26T11:45:17.114Z" })).toBe(
      "2026-07-26T11:45:17.114Z",
    );
    expect(workedSeconds({ messageEndTimestamp: "2026-07-26T11:45:29.514Z" })).toBeUndefined();
  });
});
