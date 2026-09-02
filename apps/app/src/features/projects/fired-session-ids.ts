import { scheduleSessionOf, reuseSessionIdOf, type Schedule } from "@getpie/contract";

/** Session ids a Schedule has created or reused. Origin lives here, not on the session. */
export function collectFiredSessionIds(schedules: ReadonlyArray<Schedule>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const schedule of schedules) {
    if (schedule.lastSessionId !== undefined) ids.add(schedule.lastSessionId);
    const reuseSessionId = reuseSessionIdOf(scheduleSessionOf(schedule));
    if (reuseSessionId !== undefined) ids.add(reuseSessionId);
    for (const run of schedule.runs) {
      if (run.sessionId !== undefined) ids.add(run.sessionId);
    }
  }
  return ids;
}
