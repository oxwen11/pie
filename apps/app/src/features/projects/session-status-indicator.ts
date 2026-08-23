import type { SessionPhase } from "@getpie/contract";

export type SessionStatusIndicatorProps = {
  readonly className: string;
  readonly title: string;
};

/** Maps server-derived session phase to sidebar row chrome. */
export function sessionStatusIndicator(
  phase: SessionPhase | undefined,
): SessionStatusIndicatorProps | null {
  switch (phase) {
    case "running":
      return {
        className: "ms-auto size-2 shrink-0 animate-pulse rounded-full bg-emerald-500",
        title: "A turn is running in this session",
      };
    case "requires_action":
      return {
        className: "ms-auto size-2 shrink-0 rounded-full bg-warning",
        title: "Waiting for your action",
      };
    case "crashed":
      return {
        className: "ms-auto size-2 shrink-0 rounded-full bg-destructive",
        title: "Session crashed",
      };
    case "idle":
    case undefined:
      return null;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
