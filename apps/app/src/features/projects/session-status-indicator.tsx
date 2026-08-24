import type { SessionPhase } from "@getpie/contract";

const SLOT_CLASS = "me-2 inline-flex size-2 shrink-0 items-center justify-center";

/** Server-derived session phase dot before the title; slot width is fixed when idle. */
export function SessionStatusIndicator({ phase }: { readonly phase: SessionPhase | undefined }) {
  switch (phase) {
    case "running":
      return (
        <span className={SLOT_CLASS} aria-hidden>
          <span
            className="size-2 animate-pulse rounded-full bg-emerald-500"
            title="A turn is running in this session"
          />
        </span>
      );
    case "requires_action":
      return (
        <span className={SLOT_CLASS} aria-hidden>
          <span className="bg-warning size-2 rounded-full" title="Waiting for your action" />
        </span>
      );
    case "crashed":
      return (
        <span className={SLOT_CLASS} aria-hidden>
          <span className="bg-destructive size-2 rounded-full" title="Session crashed" />
        </span>
      );
    case "idle":
    case undefined:
      return <span className={SLOT_CLASS} aria-hidden />;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
