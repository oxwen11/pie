import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import type { AgentRequest, SessionRef } from "@getpie/contract";
import { Crypto, Deferred, Effect, Fiber, FileSystem, Stream } from "effect";

import { StoreWriteError } from "../../src/errors";
import { makeEventBus } from "../../src/events/event-bus";
import type { PiAgentShape } from "../../src/harness/pi/agent";
import type { PiAgentRuntime } from "../../src/harness/pi/runtime";
import { makeProjectSessionRemoval } from "../../src/harness/project-session-removal";
import { makePiAgentSessionManager } from "../../src/harness/session-manager";
import { makePiAgentSessionRepository } from "../../src/harness/session-repository";
import {
  makePiAgentSessionService,
  type PiAgentSessionServiceShape,
} from "../../src/harness/session-service";
import { makeProjectLifecycle } from "../../src/ownership/project-lifecycle";
import { makeProjectRemoval } from "../../src/project/removal";
import { NodePlatformLayer } from "../platform";

type SessionMode = "idle" | "pending-prompt" | "requires-action" | "running";

layer(NodePlatformLayer)("Project Session removal", (it) => {
  const makeFixture = (mode: SessionMode) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-project-remove-" });
      const closed: Array<string> = [];
      let opened = 0;

      const eventsFor = (sessionId: string): PiAgentRuntime["events"] => {
        if (mode === "idle" || mode === "pending-prompt") return Stream.never;
        const started = {
          sessionId,
          body: { type: "session.turn.started" as const, sessionId, turnId: "turn-1" },
        };
        if (mode === "running") return Stream.concat(Stream.make(started), Stream.never);
        const request: AgentRequest = {
          type: "question",
          id: "request-1",
          questions: [],
          native: null,
        };
        return Stream.concat(
          Stream.fromArray([
            started,
            { sessionId, body: { type: "session.request.asked" as const, sessionId, request } },
          ]),
          Stream.never,
        );
      };
      const runtime = (sessionId: string): PiAgentRuntime => ({
        sessionId,
        events: eventsFor(sessionId),
        prompt: () => Effect.succeed({ turnId: "turn-1" }),
        interrupt: Effect.void,
        respondToAgentRequest: () => Effect.void,
        getCapabilities: Effect.succeed({
          supportsResume: true,
          supportsSteering: false,
          supportsPermissions: false,
        }),
        close: Effect.sync(() => closed.push(sessionId)).pipe(Effect.asVoid),
      });
      const pi = {
        availability: Effect.succeed({ available: true }),
        create: () =>
          Effect.sync(() => {
            opened += 1;
            return runtime(`native-${opened}`);
          }),
        resume: ({ sessionId }) => Effect.succeed(runtime(sessionId)),
        getSessionInfo: () => Effect.succeed({ _tag: "unsupported" }),
      } satisfies PiAgentShape;
      const bus = yield* makeEventBus();
      const manager = yield* makePiAgentSessionManager(pi, bus);
      const repo = yield* makePiAgentSessionRepository(path.join(home, "storage", "sessions"));
      const reverseLookupObserved = yield* Deferred.make<void>();
      const projectLifecycle = makeProjectLifecycle();
      let stagedRemovals = 0;
      let projects = [
        {
          id: "proj-a",
          name: "pie-app",
          path: "/tmp/pie-app",
          createdAt: "2026-08-30T00:00:00.000Z",
        },
      ];
      const projectRepo = {
        list: () => Effect.succeed(projects),
        save: (next: ReadonlyArray<(typeof projects)[number]>) =>
          Effect.sync(() => void (projects = Array.from(next))),
      };
      const service = makePiAgentSessionService({
        manager,
        pi,
        repo: {
          ...repo,
          findBySessionId: (sessionId) =>
            repo
              .findBySessionId(sessionId)
              .pipe(Effect.tap(() => Deferred.succeed(reverseLookupObserved, undefined))),
        },
        bus,
        projectLifecycle,
        newSessionId: crypto.randomUUIDv4.pipe(Effect.orDie),
      });
      const projectSessions = makeProjectSessionRemoval({
        bus,
        manager,
        sessions: {
          ...repo,
          stageProjectRemoval: (projectId) =>
            Effect.sync(() => {
              stagedRemovals += 1;
            }).pipe(Effect.andThen(repo.stageProjectRemoval(projectId))),
        },
      });
      const removal = makeProjectRemoval({
        bus,
        lifecycle: projectLifecycle,
        projects: projectRepo,
        sessions: projectSessions,
      });
      return {
        bus,
        closed,
        manager,
        projectLifecycle,
        projectSessions,
        projectRepo,
        projects: () => projects,
        removal,
        repo,
        reverseLookupObserved,
        service,
        stagedRemovals: () => stagedRemovals,
      };
    });

  const waitForPhase = (
    service: PiAgentSessionServiceShape,
    ref: SessionRef,
    phase: "requires_action" | "running",
  ) =>
    Effect.gen(function* () {
      while ((yield* service.getStatus(ref)).phase !== phase) {
        yield* Effect.sleep("10 millis");
      }
    });

  it.effect("removes every idle or archived Session owned by the Project", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      yield* fixture.service.create("proj-a", "/tmp/pie-app");
      const archived = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      yield* fixture.service.archive(archived, true);

      yield* fixture.removal.remove("proj-a");

      assert.deepEqual(yield* fixture.repo.list("proj-a"), []);
      assert.deepEqual(fixture.projects(), []);
      assert.deepEqual(Array.from(fixture.closed).sort(), ["native-1", "native-2"]);
    }),
  );

  for (const mode of ["running", "requires-action"] as const) {
    it.effect(`keeps every Session when one is ${mode}`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture(mode);
        const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
        yield* waitForPhase(
          fixture.service,
          ref,
          mode === "running" ? "running" : "requires_action",
        );

        const error = yield* Effect.flip(fixture.removal.remove("proj-a"));

        assert.equal(error._tag, "ProjectSessionsBusy");
        assert.equal((yield* fixture.repo.list("proj-a")).length, 1);
        assert.equal(fixture.stagedRemovals(), 0);
        assert.deepEqual(yield* fixture.service.resolveRef(ref.sessionId), ref);
        assert.equal(fixture.projects().length, 1);
        assert.deepEqual(fixture.closed, []);
      }),
    );
  }

  it.effect("keeps an accepted prompt that has not emitted turn.started yet", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("pending-prompt");
      const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      yield* fixture.service.prompt({ ref, parts: [{ type: "text", text: "hello" }] });

      const error = yield* Effect.flip(fixture.removal.remove("proj-a"));

      assert.equal(error._tag, "ProjectSessionsBusy");
      assert.equal((yield* fixture.repo.list("proj-a")).length, 1);
      assert.equal(fixture.stagedRemovals(), 0);
    }),
  );

  it.effect("restores Session metadata when unregistering the Project fails", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      const project = {
        id: "proj-a",
        name: "pie-app",
        path: "/tmp/pie-app",
        createdAt: "2026-08-30T00:00:00.000Z",
      };
      const removal = makeProjectRemoval({
        bus: fixture.bus,
        lifecycle: makeProjectLifecycle(),
        projects: {
          list: () => Effect.succeed([project]),
          save: () =>
            Effect.fail(new StoreWriteError({ file: "projects.json", cause: "write failed" })),
        },
        sessions: fixture.projectSessions,
      });

      yield* Effect.flip(removal.remove(project.id));

      assert.deepEqual(yield* fixture.repo.list(project.id), [
        {
          sessionId: ref.sessionId,
          projectId: project.id,
          agentSessionId: "native-1",
          createdAt: (yield* fixture.repo.read(project.id, ref.sessionId)).createdAt,
          cwd: project.path,
          archived: false,
        },
      ]);
    }),
  );

  it.effect("restores the Project registry when staged metadata cannot be committed", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      const removal = makeProjectRemoval({
        bus: fixture.bus,
        lifecycle: fixture.projectLifecycle,
        projects: fixture.projectRepo,
        sessions: {
          recover: fixture.projectSessions.recover,
          stage: (projectId) =>
            fixture.projectSessions.stage(projectId).pipe(
              Effect.map((staged) => ({
                ...staged,
                commit: Effect.fail(
                  new StoreWriteError({ file: "sessions-removing", cause: "remove failed" }),
                ),
              })),
            ),
        },
      });

      yield* Effect.flip(removal.remove("proj-a"));

      assert.equal(fixture.projects().length, 1);
      assert.equal((yield* fixture.repo.read("proj-a", ref.sessionId)).sessionId, ref.sessionId);
    }),
  );

  it.effect("waits for Project-owned state creation before removal", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const owner = yield* fixture.projectLifecycle
        .withProject(
          "proj-a",
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const removal = yield* fixture.removal.remove("proj-a").pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.equal(fixture.projects().length, 1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(owner);
      yield* Fiber.join(removal);
      assert.deepEqual(fixture.projects(), []);
    }),
  );

  it.effect("coordinates reverse Session lookup with Project removal", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      const entered = yield* Deferred.make<void>();
      const removeMetadata = yield* Deferred.make<void>();
      const owner = yield* fixture.projectLifecycle
        .withProject(
          "proj-a",
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(removeMetadata)),
            Effect.andThen(fixture.repo.stageProjectRemoval("proj-a")),
            Effect.flatMap((staged) => staged.commit),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);

      const lookup = yield* fixture.service.resolveRef(ref.sessionId).pipe(Effect.forkChild);
      yield* Deferred.await(fixture.reverseLookupObserved);

      assert.equal(lookup.pollUnsafe(), undefined);
      yield* Deferred.succeed(removeMetadata, undefined);
      yield* Fiber.join(owner);
      const error = yield* Effect.flip(Fiber.join(lookup));
      assert.equal(error._tag, "SessionRefNotFound");
    }),
  );

  it.effect("restores staged Session metadata after a crash when the Project remains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      const ref = yield* fixture.service.create("proj-a", "/tmp/pie-app");
      yield* fixture.repo.stageProjectRemoval("proj-a");

      yield* fixture.projectSessions.recover(new Set(["proj-a"]));

      assert.equal((yield* fixture.repo.read("proj-a", ref.sessionId)).sessionId, ref.sessionId);
    }),
  );

  it.effect("finishes staged Session deletion after a crash when the Project is gone", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("idle");
      yield* fixture.service.create("proj-a", "/tmp/pie-app");
      yield* fixture.repo.stageProjectRemoval("proj-a");

      yield* fixture.projectSessions.recover(new Set());

      assert.deepEqual(yield* fixture.repo.list("proj-a"), []);
    }),
  );
});
