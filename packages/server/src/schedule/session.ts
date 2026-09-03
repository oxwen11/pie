import type {
  ScheduleRunSnapshot,
  ScheduleSession,
  SessionPhase,
  SessionRef,
} from "@getpie/contract";
import { reuseSessionIdOf, scheduleSessionOf } from "@getpie/contract";
import { Effect } from "effect";

import {
  InvalidSchedule,
  type ProjectNotFound,
  type StoreReadError,
  type StoreWriteError,
} from "../errors";
import type { GitWorktreeFailure } from "../git/worktree-service";
import { type PiAgentSessionServiceShape, PiAgentSessionService } from "../harness";
import { ProjectService } from "../project";
import { titleFromName } from "./run-record";

export type FoundSession = {
  readonly archived: boolean;
};

export const isBusy = (phase: SessionPhase): boolean =>
  phase === "running" || phase === "requires_action";

export const findSession = (
  sessions: PiAgentSessionServiceShape,
  ref: SessionRef,
): Effect.Effect<FoundSession | null, StoreReadError> =>
  Effect.gen(function* () {
    const open = yield* sessions.list(ref.projectId, false);
    if (open.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: false };
    }
    const archived = yield* sessions.list(ref.projectId, true);
    if (archived.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: true };
    }
    return null;
  });

export const trySession = (
  projectId: string,
  session: ScheduleSession | undefined,
): Effect.Effect<void, StoreReadError | InvalidSchedule, PiAgentSessionService> => {
  const sessionId = session === undefined ? undefined : reuseSessionIdOf(session);
  if (sessionId === undefined) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const sessions = yield* PiAgentSessionService;
    const found = yield* findSession(sessions, { projectId, sessionId });
    if (found === null) {
      return yield* Effect.fail(new InvalidSchedule({ reason: "session not found" }));
    }
    if (found.archived) {
      return yield* Effect.fail(new InvalidSchedule({ reason: "session is archived" }));
    }
  });
};

export const fireSession = (
  snapshot: ScheduleRunSnapshot,
): Effect.Effect<
  SessionRef,
  ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure,
  ProjectService | PiAgentSessionService
> =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const project = yield* projects.findById(snapshot.projectId);
    const reuseSessionId = reuseSessionIdOf(scheduleSessionOf(snapshot));
    if (reuseSessionId !== undefined) {
      const ref = { projectId: snapshot.projectId, sessionId: reuseSessionId };
      const found = yield* findSession(sessions, ref);
      if (found !== null && !found.archived) {
        return ref;
      }
    }
    const created = yield* sessions.create({
      projectId: snapshot.projectId,
      cwd: project.path,
      title: titleFromName(snapshot.name),
      ...(snapshot.provider !== undefined && snapshot.modelId !== undefined
        ? { model: { provider: snapshot.provider, modelId: snapshot.modelId } }
        : undefined),
      ...(snapshot.worktree !== undefined ? { worktree: snapshot.worktree } : undefined),
    });
    return created.ref;
  });
