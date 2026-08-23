import type { SessionPhase } from "@getpie/contract";

/** Server-derived session phase dot shown before the title in a sidebar row. */
export function SessionStatusIndicator({ phase }: { readonly phase: SessionPhase | undefined }) {
  switch (phase) {
    case "running":
      return (
        <span
          className="me-2 size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
          title="A turn is running in this session"
        />
      );
    case "requires_action":
      return (
        <span
          className="bg-warning me-2 size-2 shrink-0 rounded-full"
          title="Waiting for your action"
        />
      );
    case "crashed":
      return (
        <span
          className="bg-destructive me-2 size-2 shrink-0 rounded-full"
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
