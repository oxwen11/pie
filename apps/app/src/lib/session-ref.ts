import type { SessionRef } from "@getpie/contract";

/** A session on a connected Environment. Wire ops still use `SessionRef`. */
export type EnvironmentSessionRef = {
  readonly environmentId: string;
  readonly sessionId: string;
  readonly projectId: string;
};

export const toSessionRef = (ref: EnvironmentSessionRef): SessionRef => ({
  projectId: ref.projectId,
  sessionId: ref.sessionId,
});

export const toEnvironmentSessionRef = (
  environmentId: string,
  ref: SessionRef,
): EnvironmentSessionRef => ({
  environmentId,
  projectId: ref.projectId,
  sessionId: ref.sessionId,
});

/** Stable client-side key: which Environment, which session. */
export const sessionRefKey = (ref: EnvironmentSessionRef): string =>
  JSON.stringify([ref.environmentId, ref.sessionId]);

/** Compare Environment + session; a bare sessionId is never sufficient. */
export const sameSessionRef = (
  left: EnvironmentSessionRef,
  right: EnvironmentSessionRef | null | undefined,
): boolean =>
  right !== null &&
  right !== undefined &&
  left.environmentId === right.environmentId &&
  left.sessionId === right.sessionId;

/** The session-route loader ref on live router matches. Read at call time. */
export const sessionRefFromRouterMatches = (
  matches: ReadonlyArray<{
    readonly routeId: string;
    readonly loaderData?: {
      readonly ref?: SessionRef;
      readonly environmentId?: string;
    };
  }>,
): EnvironmentSessionRef | undefined => {
  const match = matches.find((entry) => entry.routeId === "/session/$sessionId");
  const ref = match?.loaderData?.ref;
  const environmentId = match?.loaderData?.environmentId;
  if (ref === undefined || environmentId === undefined || environmentId.length === 0) {
    return undefined;
  }
  return { environmentId, sessionId: ref.sessionId, projectId: ref.projectId };
};
