import type { SessionPhase } from "@getpie/contract";

/** Server-derived session phase dot shown at the end of a sidebar row. */
export function SessionStatusIndicator({ phase }: { readonly phase: SessionPhase | undefined }) {
  switch (phase) {
    case "running":
      return (
        <span
          className="ms-auto size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
          title="A turn is running in this session"
        />
      );
    case "requires_action":
      return (
        <span
          className="bg-warning ms-auto size-2 shrink-0 rounded-full"
          title="Waiting for your action"
        />
      );
    case "crashed":
      return (
        <span
          className="bg-destructive ms-auto size-2 shrink-0 rounded-full"
          title="Session crashed"
        />
      );
    case "idle":
    case undefined:
      return null;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
