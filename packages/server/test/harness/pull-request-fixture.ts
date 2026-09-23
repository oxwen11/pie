import type { PullRequestSummary } from "@getpie/contract/pull-request";
import { Context, Crypto, Effect, FileSystem, Layer, Stream } from "effect";

import { StoreReadError, StoreWriteError } from "../../src/errors";
import { EventBus, makeEventBus } from "../../src/events/event-bus";
import { GitService } from "../../src/git/service";
import { WorktreeService } from "../../src/git/worktree-service";
import { PiAgent, type PiAgentShape } from "../../src/harness/pi/agent";
import { SessionMetadataLocksLayer } from "../../src/harness/session-locks";
import {
  makePiAgentSessionManager,
  PiAgentSessionManager,
} from "../../src/harness/session-manager";
import { SessionMetadataLayer } from "../../src/harness/session-metadata";
import {
  makePiAgentSessionRepository,
  PiAgentSessionRepository,
} from "../../src/harness/session-repository";
import {
  PiAgentSessionService,
  PiAgentSessionServiceCoreLayer,
} from "../../src/harness/session-service";
import { ProjectService } from "../../src/project/service";
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
          prompt: () => Effect.succeed({ turnId: "turn", started: true }),
          interrupt: Effect.void,
          replaceQueue: () => Effect.void,
          respondToAgentRequest: () => Effect.void,
          getCapabilities: Effect.succeed({
            supportsResume: true,
            supportsSteering: false,
            supportsPermissions: false,
          }),
          getMessages: Effect.succeed([]),
          getModelState: Effect.succeed({}),
          setModel: (model) => Effect.succeed(model),
          close: Effect.void,
        };
      }),
    resume: () => Effect.die("unexpected resume"),
    getSessionInfo: () => Effect.succeed({ _tag: "unsupported" }),
  };
  const bus = yield* makeEventBus();
  const manager = yield* makePiAgentSessionManager(pi, bus);
  const projects = ProjectService.of({
    list: () => Effect.succeed([]),
    findById: () =>
      Effect.succeed({
        id: "project",
        name: "project",
        path: home,
        createdAt: "1970-01-01T00:00:00.000Z",
      }),
    findByPath: () => Effect.succeed(undefined),
    create: () => Effect.die("unused"),
    allocateChatProjectDir: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  });
  const git = GitService.of({
    status: () => Effect.die("unexpected git status"),
    branch: () =>
      Effect.sync(() => {
        calls.branch++;
        return {
          kind: "repository" as const,
          current: branch,
          defaultBranch: "main",
          branches: [branch],
          remotes: [],
        };
      }),
    review: () => Effect.die("unexpected git review"),
    diff: () => Effect.die("unexpected git diff"),
  });
  const worktrees = WorktreeService.of({
    create: () => Effect.die("unexpected worktree"),
    restore: () => Effect.die("unexpected worktree restore"),
    remove: () =>
      Effect.sync(() => {
        calls.remove++;
      }),
  });
  const locksLayer = SessionMetadataLocksLayer;
  const context = yield* Layer.build(
    Layer.mergeAll(PiAgentSessionServiceCoreLayer, locksLayer).pipe(
      Layer.provide(SessionMetadataLayer),
      Layer.provide(locksLayer),
      Layer.provide(Layer.succeed(PiAgentSessionRepository, repo)),
      Layer.provide(Layer.succeed(PiAgentSessionManager, manager)),
      Layer.provide(Layer.succeed(PiAgent, pi)),
      Layer.provide(Layer.succeed(EventBus, bus)),
      Layer.provide(Layer.succeed(ProjectService, projects)),
      Layer.provide(Layer.succeed(WorktreeService, worktrees)),
      Layer.provide(Layer.succeed(GitService, git)),
      Layer.provide(Layer.succeed(Crypto.Crypto, crypto)),
    ),
  );
  const service = Context.get(context, PiAgentSessionService);
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
