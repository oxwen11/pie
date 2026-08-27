import { Effect } from "effect";

import { AutomationService } from "./service";

export const AUTOMATION_TICK_INTERVAL = "15 seconds" as const;

/**
 * Process-lifetime loop. The daemon — not any Session — is the clock:
 * each tick creates a fresh session when an Automation is due.
 */
export const runAutomationLoop = Effect.gen(function* () {
  const automations = yield* AutomationService;
  yield* Effect.logInfo("automation daemon started").pipe(
    Effect.annotateLogs({ event: "automation.daemon_started" }),
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
      Effect.andThen(Effect.sleep(AUTOMATION_TICK_INTERVAL)),
    ),
  );
});
