import assert from "node:assert/strict";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Context, Crypto, Effect, FileSystem, Layer, Stream } from "effect";
import { afterEach, vi } from "vitest";

import { EventBus, makeEventBus } from "../../../src/events/event-bus";
import { GitService } from "../../../src/git/service";
import { WorktreeService } from "../../../src/git/worktree-service";
import { makePiAgent, PiAgent } from "../../../src/harness/pi/agent";
import { makePiProcess } from "../../../src/harness/pi/process";
import { SessionMetadataLocksLayer } from "../../../src/harness/session-locks";
import {
  makePiAgentSessionManager,
  PiAgentSessionManager,
} from "../../../src/harness/session-manager";
import { SessionMetadataLayer } from "../../../src/harness/session-metadata";
import {
  makePiAgentSessionRepository,
  PiAgentSessionRepository,
} from "../../../src/harness/session-repository";
import {
  PiAgentSessionService,
  PiAgentSessionServiceCoreLayer,
} from "../../../src/harness/session-service";
import { ProjectService } from "../../../src/project/service";
import { makePullRequestCoordinator } from "../../../src/pull-request/coordinator";

const cli = url.fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
const provider = url.fileURLToPath(
  new URL("./fixtures/registration-provider.mjs", import.meta.url),
);
const pullRequest = { host: "github.com", owner: "owner", repository: "repo", number: 42 };
const prUrl = "https://github.com/owner/repo/pull/42";
afterEach(() => vi.unstubAllEnvs());

layer(NodeServices.layer, { excludeTestServices: true })(
  "Session registration composition",
  (it) => {
    it.effect(
      "wires real Pi tools through Session creation and every resume path without GitHub reads",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const crypto = yield* Crypto.Crypto;
          const home = yield* fs.makeTempDirectoryScoped({
            prefix: "pie-registration-composition-",
          });
          vi.stubEnv("PI_CODING_AGENT_DIR", home);
          const executable = { command: process.execPath, prefixArgs: [cli] };
          const piProcess = yield* makePiProcess({
            executable,
            args: [
              "--offline",
              "--no-extensions",
              "--no-skills",
              "--no-context-files",
              "--no-prompt-templates",
              "--no-themes",
              "--extension",
              provider,
            ],
          });
          const pi = yield* makePiAgent(piProcess, { executable });
          const bus = yield* makeEventBus();
          const manager = yield* makePiAgentSessionManager(pi, bus);
          const repo = yield* makePiAgentSessionRepository(`${home}/metadata`);
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
            branch: () => Effect.succeed({ kind: "not-repository" as const }),
            review: () => Effect.die("unexpected git review"),
            diff: () => Effect.die("unexpected git diff"),
          });
          const worktrees = WorktreeService.of({
            create: () => Effect.die("Unexpected worktree creation"),
            restore: () => Effect.die("Unexpected worktree restore"),
            remove: () => Effect.die("Unexpected worktree removal"),
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
          let remoteReads = 0;
          const remote = Effect.sync(() => {
            remoteReads++;
            return null;
          });
          const coordinator = yield* makePullRequestCoordinator({
            sessions: service,
            bus,
            github: { summary: () => remote, discover: () => remote, stack: () => remote },
            newLeaseId: crypto.randomUUIDv4.pipe(Effect.orDie),
            projectPathFor: () => Effect.succeed(home),
          });
          const { ref } = yield* service.create({
            projectId: "project",
            cwd: home,
            model: { provider: "registration-test", modelId: "model" },
          });
          const run = (tool: string, input: { url: string; restore?: boolean }) =>
            Effect.gen(function* () {
              const events = yield* bus.subscribe({ kind: "session", ref });
              yield* service.prompt({
                ref,
                parts: [{ type: "text", text: JSON.stringify({ tool, input }) }],
              });
              const messages = yield* Stream.runCollect(
                events.pipe(
                  Stream.takeUntil(
                    (message) =>
                      message.type === "event" && message.event.type === "session.turn.ended",
                  ),
                ),
              ).pipe(Effect.timeout("10 seconds"));
              assert.ok(
                messages.some(
                  (message) =>
                    message.type === "event" &&
                    message.event.type === "session.message.chunk" &&
                    message.event.chunk.type === "tool-output-available",
                ),
              );
            });
          yield* run("session_register_pull_request", { url: prUrl });
          assert.deepEqual(
            (yield* repo.read(ref.projectId, ref.sessionId)).pullRequests?.map((link) => link.ref),
            [pullRequest],
          );
          yield* service.close(ref);
          yield* service.getMessages(ref); // History acquires a real, newly scoped Pi process.
          yield* run("session_exclude_pull_request", { url: prUrl });
          assert.equal((yield* service.pullRequestsFor(ref))[0]?.excluded, true);
          yield* service.close(ref);
          yield* service.getModelState(ref); // Model reads use the shared live-runtime acquisition path.
          yield* run("session_register_pull_request", { url: prUrl, restore: true });
          assert.equal((yield* coordinator.statuses([ref]))[0]?.links[0]?.excluded, false);
          assert.equal(remoteReads, 0);
          yield* service.close(ref);
        }),
      30000,
    );
  },
);
