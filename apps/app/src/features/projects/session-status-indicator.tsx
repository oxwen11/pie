import type { SessionPhase } from "@getpie/contract";
import { Spinner } from "@getpie/ui/components/spinner";

const SLOT_CLASS = "inline-flex size-3 shrink-0 items-center justify-center";

/** Server-derived session phase before the title; slot width is fixed when idle. */
export function SessionStatusIndicator({ phase }: { readonly phase: SessionPhase | undefined }) {
  switch (phase) {
    case "running":
      return (
        <span
          className={SLOT_CLASS}
          data-slot="session-status"
          data-state="loading"
          title="A turn is running in this session"
        >
          <Spinner className="size-3" aria-label="A turn is running in this session" />
        </span>
      );
    case "requires_action":
      return (
        <span
          className={SLOT_CLASS}
          aria-label="Waiting for your action"
          data-slot="session-status"
          data-state="requires-action"
          role="img"
          title="Waiting for your action"
        >
          <span className="bg-warning size-2 rounded-full" aria-hidden />
        </span>
      );
    case "crashed":
      return (
        <span
          className={SLOT_CLASS}
          aria-label="Session crashed"
          data-slot="session-status"
          data-state="crashed"
          role="img"
          title="Session crashed"
        >
          <span className="bg-destructive size-2 rounded-full" aria-hidden />
        </span>
      );
    case "idle":
    case undefined:
      return <span className={SLOT_CLASS} aria-hidden data-slot="session-status" />;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
