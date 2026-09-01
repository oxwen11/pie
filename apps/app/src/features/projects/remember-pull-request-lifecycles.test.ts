import type { PullRequestLifecycle } from "@getpie/contract/pull-request";
import { describe, expect, it } from "vitest";

import {
  rememberPullRequestLifecycle,
  rememberPullRequestLifecycles,
} from "./remember-pull-request-lifecycles";

const open: PullRequestLifecycle = { type: "open", draft: false };
const draft: PullRequestLifecycle = { type: "open", draft: true };
const merged: PullRequestLifecycle = { type: "merged" };

describe("rememberPullRequestLifecycles", () => {
  it("keeps the previous map when the read is missing or empty", () => {
    const previous = new Map([["session-1", open]]);
    expect(rememberPullRequestLifecycles(previous, undefined)).toBe(previous);
    expect(rememberPullRequestLifecycles(previous, new Map())).toBe(previous);
  });

  it("records new and updated lifecycles without dropping other sessions", () => {
    const previous = new Map([
      ["session-1", open],
      ["session-2", draft],
    ]);
    const next = rememberPullRequestLifecycles(
      previous,
      new Map([
        ["session-2", merged],
        ["session-3", open],
      ]),
    );
    expect(next).toEqual(
      new Map([
        ["session-1", open],
        ["session-2", merged],
        ["session-3", open],
      ]),
    );
  });

  it("returns the previous map when incoming values are unchanged", () => {
    const previous = new Map([["session-1", open]]);
    expect(rememberPullRequestLifecycles(previous, new Map([["session-1", open]]))).toBe(previous);
  });
});

describe("rememberPullRequestLifecycle", () => {
  it("writes the active session without clearing others", () => {
    const previous = new Map([["session-1", open]]);
    expect(rememberPullRequestLifecycle(previous, "session-2", merged)).toEqual(
      new Map([
        ["session-1", open],
        ["session-2", merged],
      ]),
    );
  });

  it("ignores a missing or empty current read", () => {
    const previous = new Map([["session-1", open]]);
    expect(rememberPullRequestLifecycle(previous, "session-1", undefined)).toBe(previous);
    expect(rememberPullRequestLifecycle(previous, "session-1", null)).toBe(previous);
    expect(rememberPullRequestLifecycle(previous, undefined, merged)).toBe(previous);
  });
});
