import { Duration, Effect } from "effect";

import { ScheduleService } from "./service";

/**
 * Process-lifetime loop. The daemon — not any Session — is the clock:
 * each tick creates a fresh session when a Schedule is due.
 */
export const runScheduleLoop = Effect.gen(function* () {
  const schedules = yield* ScheduleService;
  yield* Effect.logInfo("schedule daemon started").pipe(
    Effect.annotateLogs({ event: "schedule.daemon_started" }),
  );
  yield* schedules
    .recover()
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("schedule recover failed", cause).pipe(
          Effect.annotateLogs({ event: "schedule.recover_failed" }),
        ),
      ),
    );
  yield* Effect.forever(
    schedules.tick().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("schedule tick failed", cause).pipe(
          Effect.annotateLogs({ event: "schedule.tick_failed" }),
        ),
      ),
      Effect.andThen(schedules.nextWakeDelay()),
      Effect.flatMap((ms) => Effect.sleep(Duration.millis(ms))),
    ),
  );
});
