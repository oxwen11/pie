import { Schema } from "effect";

/** Failure while attaching or spawning the daemon: lock, port, spawn, readiness. */
export class DaemonLaunchError extends Schema.TaggedError<DaemonLaunchError>()(
  "DaemonLaunchError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * The user explicitly stopped the daemon (`daemon.stopped` tombstone present):
 * auto-respawn callers must not undo that. An explicit start clears it.
 */
export class DaemonStoppedError extends Schema.TaggedError<DaemonStoppedError>()(
  "DaemonStoppedError",
  {
    message: Schema.String,
  },
) {}
