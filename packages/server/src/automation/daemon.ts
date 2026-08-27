import { Effect } from "effect";

import { AutomationService } from "./service";

/** Upper bound for the daemon sleep. Actual delay is `nextWakeDelay` (1s–60s). */
export const AUTOMATION_TICK_INTERVAL = "60 seconds" as const;

/**
 * Process-lifetime loop. The daemon — not any Session — is the clock:
 * each tick creates a fresh session when an Automation is due.
 */
export const runAutomationLoop = Effect.gen(function* () {
  const automations = yield* AutomationService;
  yield* Effect.logInfo("automation daemon started").pipe(
    Effect.annotateLogs({ event: "automation.daemon_started" }),
  );
  yield* automations.recover().pipe(
    Effect.catch((error) =>
      Effect.logWarning("automation recover failed").pipe(
        Effect.annotateLogs({
          event: "automation.recover_failed",
          error: String(error),
        }),
      ),
    ),
  );
  yield* Effect.forever(
    automations.tick().pipe(
      Effect.catch((error) =>
        Effect.logWarning("automation tick failed").pipe(
          Effect.annotateLogs({
            event: "automation.tick_failed",
            error: String(error),
          }),
        ),
      ),
      Effect.andThen(automations.nextWakeDelay()),
      Effect.flatMap((ms) => Effect.sleep(`${ms} millis`)),
    ),
  );
});
