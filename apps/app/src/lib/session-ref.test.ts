import { describe, expect, it } from "vitest";

import {
  type EnvironmentSessionRef,
  sameSessionRef,
  sessionRefFromRouterMatches,
  sessionRefKey,
  toEnvironmentSessionRef,
  toSessionRef,
} from "./session-ref";

const ref = (overrides: Partial<EnvironmentSessionRef> = {}): EnvironmentSessionRef => ({
  environmentId: "env-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "shared-session-id",
  ...overrides,
});

describe("EnvironmentSessionRef identity", () => {
  it("compares Environment and session, not projectId", () => {
    expect(sameSessionRef(ref(), ref())).toBe(true);
    expect(sameSessionRef(ref(), ref({ environmentId: "env-2" }))).toBe(false);
    expect(sameSessionRef(ref(), ref({ sessionId: "other-session" }))).toBe(false);
    expect(sameSessionRef(ref(), ref({ projectId: "22222222-2222-4222-8222-222222222222" }))).toBe(
      true,
    );
    expect(sameSessionRef(ref(), null)).toBe(false);
  });

  it("keys the same session on different Environments apart", () => {
    expect(sessionRefKey(ref())).toBe(sessionRefKey(ref()));
    expect(sessionRefKey(ref())).not.toBe(sessionRefKey(ref({ environmentId: "env-2" })));
  });

  it("round-trips the wire SessionRef through an Environment", () => {
    expect(toSessionRef(ref())).toEqual({
      projectId: ref().projectId,
      sessionId: ref().sessionId,
    });
    expect(toEnvironmentSessionRef("env-1", toSessionRef(ref()))).toEqual(ref());
  });

  it("reads the session-route loader ref from router matches", () => {
    expect(
      sessionRefFromRouterMatches([
        { routeId: "__root__" },
        {
          routeId: "/session/$sessionId",
          loaderData: {
            ref: { projectId: ref().projectId, sessionId: ref().sessionId },
            environmentId: "env-1",
          },
        },
      ]),
    ).toEqual(ref());
    expect(sessionRefFromRouterMatches([{ routeId: "/draft" }])).toBeUndefined();
  });
});
