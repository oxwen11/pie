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
  if (ref === undefined || data === null || typeof data !== "object" || !("environmentId" in data)) {
    return undefined;
  }
  const environmentId = data.environmentId;
  if (typeof environmentId !== "string" || environmentId.length === 0) return undefined;
  return { environmentId, sessionId: ref.sessionId, projectId: ref.projectId };
};
