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
import { PiAgentSessionService } from "../harness";
import { SessionMetadata, type SessionMetadataShape } from "../harness/session-metadata";
import { ProjectService } from "../project";
import { titleFromName } from "./run-record";

export type FoundSession = {
  readonly archived: boolean;
};

export const isBusy = (phase: SessionPhase): boolean =>
  phase === "running" || phase === "requires_action";

export const findSession = (
  metadata: SessionMetadataShape,
  ref: SessionRef,
): Effect.Effect<FoundSession | null, StoreReadError> =>
  Effect.gen(function* () {
    const open = yield* metadata.list(ref.projectId, false);
    if (open.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: false };
    }
    const archived = yield* metadata.list(ref.projectId, true);
    if (archived.some((session) => session.sessionId === ref.sessionId)) {
      return { archived: true };
    }
    return null;
  });

export const trySession = (
  projectId: string,
  session: ScheduleSession | undefined,
): Effect.Effect<void, StoreReadError | InvalidSchedule, SessionMetadata> => {
  const sessionId = session === undefined ? undefined : reuseSessionIdOf(session);
  if (sessionId === undefined) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const metadata = yield* SessionMetadata;
    const found = yield* findSession(metadata, { projectId, sessionId });
    if (found === null) {
      return yield* Effect.fail(new InvalidSchedule({ reason: "session not found" }));
    }
    if (found.archived) {
      return yield* Effect.fail(new InvalidSchedule({ reason: "session is archived" }));
    }
    return undefined;
  });
};

export const fireSession = (
  snapshot: ScheduleRunSnapshot,
): Effect.Effect<
  SessionRef,
  ProjectNotFound | StoreReadError | StoreWriteError | GitWorktreeFailure,
  ProjectService | PiAgentSessionService | SessionMetadata
> =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const sessions = yield* PiAgentSessionService;
    const metadata = yield* SessionMetadata;
    const project = yield* projects.findById(snapshot.projectId);
    const reuseSessionId = reuseSessionIdOf(scheduleSessionOf(snapshot));
    if (reuseSessionId !== undefined) {
      const ref = { projectId: snapshot.projectId, sessionId: reuseSessionId };
      const found = yield* findSession(metadata, ref);
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
