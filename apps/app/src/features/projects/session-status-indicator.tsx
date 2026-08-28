import type { SessionPhase } from "@getpie/contract";
import { Spinner } from "@getpie/ui/components/spinner";

const SLOT_CLASS = "me-2 inline-flex size-3 shrink-0 items-center justify-center";

/** Server-derived session phase before the title; slot width is fixed when idle. */
export function SessionStatusIndicator({ phase }: { readonly phase: SessionPhase | undefined }) {
  switch (phase) {
    case "running":
      return (
        <span className={SLOT_CLASS} data-slot="session-status" data-state="loading">
          <Spinner
            className="size-3"
            aria-label="A turn is running in this session"
            title="A turn is running in this session"
          />
        </span>
      );
    case "requires_action":
      return (
        <span
          className={SLOT_CLASS}
          aria-hidden
          data-slot="session-status"
          data-state="requires-action"
        >
          <span className="bg-warning size-2 rounded-full" title="Waiting for your action" />
        </span>
      );
    case "crashed":
      return (
        <span className={SLOT_CLASS} aria-hidden data-slot="session-status" data-state="crashed">
          <span className="bg-destructive size-2 rounded-full" title="Session crashed" />
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
