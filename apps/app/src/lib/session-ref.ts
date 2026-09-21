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

const sessionLoaderRef = (data: unknown): SessionRef | undefined => {
  if (data === null || typeof data !== "object" || !("ref" in data)) return undefined;
  const ref = data.ref;
  if (
    typeof ref !== "object" ||
    ref === null ||
    !("projectId" in ref) ||
    !("sessionId" in ref) ||
    typeof ref.projectId !== "string" ||
    typeof ref.sessionId !== "string"
  ) {
    return undefined;
  }
  return { projectId: ref.projectId, sessionId: ref.sessionId };
};

/** The session-route loader ref on live router matches. Read at call time. */
export const sessionRefFromRouterMatches = (
  matches: ReadonlyArray<{
    readonly routeId: string;
    readonly loaderData?: unknown;
  }>,
): EnvironmentSessionRef | undefined => {
  const data = matches.find((match) => match.routeId === "/session/$sessionId")?.loaderData;
  const ref = sessionLoaderRef(data);
  if (
    ref === undefined ||
    data === null ||
    typeof data !== "object" ||
    !("environmentId" in data)
  ) {
    return undefined;
  }
  const environmentId = data.environmentId;
  if (typeof environmentId !== "string" || environmentId.length === 0) return undefined;
  return { environmentId, ref };
};
