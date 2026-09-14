import assert from "node:assert/strict";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Stream } from "effect";
import { afterEach, vi } from "vitest";

import { makeEventBus } from "../../../src/events/event-bus";
import { makePiAgent } from "../../../src/harness/pi/agent";
import { makePiProcess } from "../../../src/harness/pi/process";
import { makePiAgentSessionManager } from "../../../src/harness/session-manager";
import { makePiAgentSessionRepository } from "../../../src/harness/session-repository";
import { makePiAgentSessionService } from "../../../src/harness/session-service";
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
          const pi = makePiAgent(piProcess, { executable });
          const bus = yield* makeEventBus();
          const manager = yield* makePiAgentSessionManager(pi, bus);
          const repo = yield* makePiAgentSessionRepository(`${home}/metadata`);
          const service = makePiAgentSessionService({
            pi,
            manager,
            bus,
            repo,
            newSessionId: crypto.randomUUIDv4.pipe(Effect.orDie),
            projectPathFor: () => Effect.succeed(home),
            worktrees: {
              create: () => Effect.die("Unexpected worktree creation"),
              remove: () => Effect.die("Unexpected worktree removal"),
            },
          });
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
