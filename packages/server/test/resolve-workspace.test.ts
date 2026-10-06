import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { SessionNotFound, StoreReadError } from "../src/errors";
import { catchWorkspaceResolveErrors } from "../src/rpc/resolve-workspace";

const errors = {
  SESSION_NOT_FOUND: (input: { data: { message: string } }) => ({
    code: "SESSION_NOT_FOUND" as const,
    ...input,
  }),
  INTERNAL: (input: { data: { message: string } }) => ({
    code: "INTERNAL" as const,
    ...input,
  }),
};

describe("catchWorkspaceResolveErrors", () => {
  it("maps a store read failure to INTERNAL", async () => {
    const result = await Effect.runPromise(
      Effect.fail(new StoreReadError({ file: "sessions/a.json", cause: new Error("io") })).pipe(
        catchWorkspaceResolveErrors(errors),
        Effect.flip,
      ),
    );

    expect(result).toEqual({
      code: "INTERNAL",
      data: { message: "session store read failed: sessions/a.json" },
    });
  });

  it("still maps a missing session to SESSION_NOT_FOUND", async () => {
    const result = await Effect.runPromise(
      Effect.fail(new SessionNotFound({ projectId: "p1", sessionId: "s1" })).pipe(
        catchWorkspaceResolveErrors(errors),
        Effect.flip,
      ),
    );

    expect(result).toEqual({
      code: "SESSION_NOT_FOUND",
      data: { message: "session s1 not found" },
    });
  });
});
