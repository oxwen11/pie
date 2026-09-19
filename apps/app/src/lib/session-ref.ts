import type { SessionRef } from "@getpie/contract";

/** Stable client-side key for the complete session identity. */
export const sessionRefKey = (ref: SessionRef): string =>
  JSON.stringify([ref.projectId, ref.sessionId]);

/** Compare all identity fields; a bare sessionId is never sufficient. */
export const sameSessionRef = (left: SessionRef, right: SessionRef | null | undefined): boolean =>
  right !== null &&
  right !== undefined &&
  left.projectId === right.projectId &&
  left.sessionId === right.sessionId;

/** The session-route loader ref on live router matches. Read at call time. */
export const sessionRefFromRouterMatches = (
  matches: ReadonlyArray<{
    readonly routeId: string;
    readonly loaderData?: { readonly ref?: SessionRef };
  }>,
): SessionRef | undefined =>
  matches.find((match) => match.routeId === "/session/$sessionId")?.loaderData?.ref;
