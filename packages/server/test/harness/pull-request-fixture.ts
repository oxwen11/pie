import type { PullRequestSummary } from "@getpie/contract/pull-request";
import { Crypto, Effect, FileSystem, Stream } from "effect";

import { StoreReadError, StoreWriteError } from "../../src/errors";
import { makeEventBus } from "../../src/events/event-bus";
import type { PiAgentShape } from "../../src/harness/pi/agent";
import { makePiAgentSessionManager } from "../../src/harness/session-manager";
import { makePiAgentSessionRepository } from "../../src/harness/session-repository";
import { makePiAgentSessionService } from "../../src/harness/session-service";
import type { PullRequestSummaryReader } from "../../src/pull-request/coordinator";

export const prRef = { host: "github.com", owner: "getpie", repository: "pie", number: 42 };
export const summary: PullRequestSummary = {
  ref: prRef,
  title: "Test",
  headBranch: "feature",
  baseBranch: "main",
  lifecycle: { type: "open", draft: false },
  checkedAt: "1970-01-01T00:00:00.000Z",
};
export const makeFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-pr-foundation-" });
  const stored = yield* makePiAgentSessionRepository(home);
  let writeFailure = false;
  let readFailure = false;
  const repo = {
    ...stored,
    write: (metadata: Parameters<typeof stored.write>[0]) =>
      Effect.suspend(() =>
        writeFailure
          ? Effect.fail(new StoreWriteError({ file: "test", cause: "full" }))
          : stored.write(metadata),
      ),
    read: (projectId: string, sessionId: string) =>
      Effect.suspend(() =>
        readFailure
          ? Effect.fail(new StoreReadError({ file: "test", cause: "unavailable" }))
          : stored.read(projectId, sessionId),
      ),
  };
  const calls = { open: 0, remove: 0, branch: 0 };
  let branch = "feature";
  const pi: PiAgentShape = {
    availability: Effect.succeed({ available: true }),
    create: () =>
      Effect.sync(() => {
        calls.open++;
        return {
          sessionId: "native",
          events: Stream.never,
          prompt: () => Effect.succeed({ turnId: "turn" }),
          interrupt: Effect.void,
          respondToAgentRequest: () => Effect.void,
          getCapabilities: Effect.succeed({
            supportsResume: true,
            supportsSteering: false,
            supportsPermissions: false,
          }),
          close: Effect.void,
        };
      }),
    resume: () => Effect.die("unexpected resume"),
    getSessionInfo: () => Effect.succeed({ _tag: "unsupported" }),
  };
  const bus = yield* makeEventBus();
  const manager = yield* makePiAgentSessionManager(pi, bus);
  const service = makePiAgentSessionService({
    manager,
    pi,
    repo,
    bus,
    newSessionId: crypto.randomUUIDv4.pipe(Effect.orDie),
    projectPathFor: () => Effect.succeed(home),
    branchFor: () =>
      Effect.sync(() => {
        calls.branch++;
        return branch;
      }),
    worktrees: {
      create: () => Effect.die("unexpected worktree"),
      remove: () =>
        Effect.sync(() => {
          calls.remove++;
        }),
    },
  });
  const created = yield* service.create({ projectId: "project", cwd: home });
  const github: PullRequestSummaryReader = {
    summary: () => Effect.succeed(summary),
    discover: () => Effect.succeed(null),
    stack: () => Effect.succeed(null),
  };
  return {
    fs,
    home,
    repo,
    stored,
    bus,
    manager,
    service,
    ref: created.ref,
    calls,
    github,
    newLeaseId: crypto.randomUUIDv4.pipe(Effect.orDie),
    setBranch: (value: string) => {
      branch = value;
    },
    failWrite: (value: boolean) => {
      writeFailure = value;
    },
    failRead: (value: boolean) => {
      readFailure = value;
    },
  };
});
