import type { Schedule } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import { collectFiredSessionIds } from "./fired-session-ids";

const base = {
  name: "Morning review",
  projectId: "00000000-0000-0000-0000-000000000001",
  prompt: "Review.",
  spec: { kind: "manual" as const },
  enabled: true,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  nextRunAt: null,
  runs: [],
};

describe("collectFiredSessionIds", () => {
  it("collects last, reused, and run session ids", () => {
    const schedules: ReadonlyArray<Schedule> = [
      {
        ...base,
        id: "00000000-0000-0000-0000-0000000000aa",
        lastSessionId: "sess-last",
        session: { policy: "existing", sessionId: "sess-reuse" },
        runs: [
          {
            id: "run-1",
            startedAt: "2026-08-28T00:00:00.000Z",
            reason: "manual",
            status: "succeeded",
            sessionId: "sess-run",
          },
        ],
      },
    ];
    expect(collectFiredSessionIds(schedules)).toEqual(
      new Set(["sess-last", "sess-reuse", "sess-run"]),
    );
  });

  it("returns an empty set when no session ids are recorded", () => {
    const schedules: ReadonlyArray<Schedule> = [
      { ...base, id: "00000000-0000-0000-0000-0000000000bb" },
    ];
    expect(collectFiredSessionIds(schedules).size).toBe(0);
  });
});
