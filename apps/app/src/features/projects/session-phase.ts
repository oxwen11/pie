import type { SessionPhase } from "@getpie/contract";
import type { BadgeProps } from "@getpie/ui/components/badge";

/** User-facing header/sidebar label; idle and unknown phases render nothing. */
export function formatSessionPhaseLabel(phase: SessionPhase): string | undefined {
  switch (phase) {
    case "idle":
      return undefined;
    case "running":
      return "Running";
    case "requires_action":
      return "Action needed";
    case "crashed":
      return "Error";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function sessionPhaseBadgeVariant(
  phase: SessionPhase,
): NonNullable<BadgeProps["variant"]> | undefined {
  switch (phase) {
    case "idle":
      return undefined;
    case "running":
      return "success";
    case "requires_action":
      return "warning";
    case "crashed":
      return "error";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
