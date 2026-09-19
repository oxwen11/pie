import type { SessionRef } from "@getpie/contract";

/** A session on a connected Environment. Wire ops use `.ref`. */
export type EnvironmentSessionRef = {
  readonly environmentId: string;
  readonly ref: SessionRef;
};

/** Stable client-side key: which Environment, which session. */
export const sessionRefKey = (session: EnvironmentSessionRef): string =>
  JSON.stringify([session.environmentId, session.ref.sessionId]);

/** Inverse of `sessionRefKey`. */
export const parseSessionRefKey = (
  key: string,
): { environmentId: string; sessionId: string } | null => {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const environmentId: unknown = parsed[0];
    const sessionId: unknown = parsed[1];
    if (typeof environmentId !== "string" || typeof sessionId !== "string") return null;
    return { environmentId, sessionId };
  } catch {
    return null;
  }
};

/** Compare Environment + session; a bare sessionId is never sufficient. */
export const sameSessionRef = (
  left: EnvironmentSessionRef,
  right: EnvironmentSessionRef | null | undefined,
): boolean =>
  right !== null &&
  right !== undefined &&
  left.environmentId === right.environmentId &&
  left.ref.sessionId === right.ref.sessionId;

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
  return { environmentId, ref };
};
