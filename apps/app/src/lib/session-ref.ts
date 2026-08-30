import type { SessionRef } from "@getpie/contract";

/** Stable client-side key for the complete session identity. */
export const sessionRefKey = (ref: SessionRef): string =>
  JSON.stringify([ref.projectId, ref.sessionId]);

/** Prefix shared by every encoded SessionRef owned by one Project. */
export const projectSessionRefKeyPrefix = (projectId: string): string =>
  `[${JSON.stringify(projectId)},`;

/** Compare all identity fields; a bare sessionId is never sufficient. */
export const sameSessionRef = (left: SessionRef, right: SessionRef | null | undefined): boolean =>
  right !== null &&
  right !== undefined &&
  left.projectId === right.projectId &&
  left.sessionId === right.sessionId;
