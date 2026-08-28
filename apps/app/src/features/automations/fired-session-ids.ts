import type { Automation } from "@getpie/contract";

/** Session ids an Automation has created or reused. Origin lives here, not on the session. */
export function collectFiredSessionIds(
  automations: ReadonlyArray<Automation>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const automation of automations) {
    if (automation.lastSessionId !== undefined) ids.add(automation.lastSessionId);
    if (automation.mergedSessionId !== undefined) ids.add(automation.mergedSessionId);
    for (const run of automation.runs) {
      if (run.sessionId !== undefined) ids.add(run.sessionId);
    }
  }
  return ids;
}
