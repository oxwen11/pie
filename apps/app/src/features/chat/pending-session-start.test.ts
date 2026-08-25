import { describe, expect, it } from "vitest";

import { pendingSessionStartFromState } from "./pending-session-start";

const ref = { projectId: "project-1", sessionId: "session-1" };

describe("pendingSessionStartFromState", () => {
  it("returns pending start when state matches the session ref", () => {
    const pending = {
      ref,
      text: "hello",
      workspaceMode: "project" as const,
    };
    expect(pendingSessionStartFromState({ pendingSessionStart: pending }, ref)).toEqual(pending);
  });

  it("rejects mismatched session ids", () => {
    expect(
      pendingSessionStartFromState(
        {
          pendingSessionStart: {
            ref,
            text: "hello",
            workspaceMode: "project",
          },
        },
        { ...ref, sessionId: "session-2" },
      ),
    ).toBeUndefined();
  });

  it("rejects invalid payloads", () => {
    expect(pendingSessionStartFromState(null, ref)).toBeUndefined();
    expect(
      pendingSessionStartFromState(
        { pendingSessionStart: { ref, text: "", workspaceMode: "project" } },
        ref,
      ),
    ).toBeUndefined();
  });
});
