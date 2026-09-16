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

const hasSessionLoaderRef = (data: unknown): data is { readonly ref: SessionRef } => {
  if (data === null || typeof data !== "object" || !("ref" in data)) return false;
  const ref = data.ref;
  return (
    typeof ref === "object" &&
    ref !== null &&
    "projectId" in ref &&
    "sessionId" in ref &&
    typeof ref.projectId === "string" &&
    typeof ref.sessionId === "string"
  );
};

/** The session-route loader ref on live router matches. Read at call time. */
export const sessionRefFromRouterMatches = (
  matches: ReadonlyArray<{
    readonly routeId: string;
    readonly loaderData?: unknown;
  }>,
): SessionRef | undefined => {
  const data = matches.find((match) => match.routeId === "/session/$sessionId")?.loaderData;
  if (!hasSessionLoaderRef(data)) return undefined;
  return data.ref;
};
