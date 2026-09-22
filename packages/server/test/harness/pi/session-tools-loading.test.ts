import assert from "node:assert/strict";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import type { SessionPullRequestLink } from "@getpie/contract/pull-request";
import { Deferred, Effect, Fiber, FileSystem, Stream } from "effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { afterEach, vi } from "vitest";

import { makePiAgent } from "../../../src/harness/pi/agent";
import { makePiProcess } from "../../../src/harness/pi/process";
import { PiSessionTools, type PiSessionToolsShape } from "../../../src/harness/pi/session-tools";

const provider = url.fileURLToPath(
  new URL("./fixtures/registration-provider.mjs", import.meta.url),
);
const cli = url.fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
const prUrl = "https://github.com/owner/repo/pull/42";
const ref = { host: "github.com", owner: "owner", repository: "repo", number: 42 };
const link: SessionPullRequestLink = {
  ref,
  source: "agent",
  linkedAt: "2026-09-15T00:00:00.000Z",
  excluded: false,
  snapshot: null,
  stack: null,
  stackCheckedAt: null,
};
const toolResult = (chunks: ReadonlyArray<{ readonly type: string }>) =>
  chunks.find(
    (chunk) => chunk.type === "tool-output-available" || chunk.type === "tool-output-error",
  );

afterEach(() => vi.unstubAllEnvs());

layer(NodeServices.layer, { excludeTestServices: true })(
  "actual installed Pi session tools",
  (it) => {
    it.effect(
      "loads and calls registration, list and exclusion tools on create and resume with durable ACK",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const dir = yield* fs.makeTempDirectoryScoped();
          vi.stubEnv("PI_CODING_AGENT_DIR", dir);
          vi.stubEnv("PIE_AUTH_TOKEN", "must-not-reach-pi");
          const saved = `${dir}/associations.json`;
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const callbacks: PiSessionToolsShape = {
            list: fs
              .readFileString(saved)
              .pipe(Effect.map((text) => JSON.parse(text) as SessionPullRequestLink[])),
            register: (identity, restore) =>
              Effect.gen(function* () {
                assert.deepEqual(identity, ref);
                assert.equal(restore, false);
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                yield* fs.writeFileString(saved, JSON.stringify([link]));
                return "linked" as const;
              }),
            exclude: (identity) => {
              assert.deepEqual(identity, ref);
              return fs.writeFileString(saved, JSON.stringify([{ ...link, excluded: true }]));
            },
          };
          const process = yield* makePiProcess({
            executable: { command: globalThis.process.execPath, prefixArgs: [cli] },
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
          const created = yield* process.session.create({
            cwd: dir,
            provider: "registration-test",
            modelId: "model",
            tools: callbacks,
          });
          assert.equal(yield* fs.exists(saved), false);
          const prompt = yield* process.session.prompt({
            sessionId: created.sessionId,
            text: JSON.stringify({ tool: "session_register_pull_request", input: { url: prUrl } }),
          });
          let completed = false;
          const output = yield* Stream.runCollect(prompt.output).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                completed = true;
              }),
            ),
            Effect.forkChild,
          );
          yield* Deferred.await(started);
          assert.equal(completed, false);
          assert.equal(yield* fs.exists(saved), false);
          yield* Deferred.succeed(release, undefined);
          const chunks = yield* Fiber.join(output);
          const registered = toolResult(chunks);
          assert.equal(registered?.type, "tool-output-available");
          assert.match(JSON.stringify(registered), /linked/);
          assert.deepEqual(JSON.parse(yield* fs.readFileString(saved)), [link]);
          yield* process.session.abort(created.sessionId);

          // The real Pi CLI loads the extension again while opening the existing transcript.
          const resumed = yield* process.session.resume({
            sessionId: created.sessionId,
            cwd: dir,
            tools: callbacks,
          });
          assert.equal(resumed.sessionId, created.sessionId);
          for (const [tool, input, expected] of [
            ["session_list_pull_requests", {}, "false"],
            ["session_exclude_pull_request", { url: prUrl }, "excluded"],
            ["session_list_pull_requests", {}, "true"],
          ] as const) {
            const turn = yield* process.session.prompt({
              sessionId: resumed.sessionId,
              text: JSON.stringify({ tool, input }),
            });
            const result = toolResult(yield* Stream.runCollect(turn.output));
            assert.equal(result?.type, "tool-output-available");
            assert.ok(JSON.stringify(result).includes(expected));
          }
          assert.equal(
            (JSON.parse(yield* fs.readFileString(saved)) as SessionPullRequestLink[])[0]?.excluded,
            true,
          );
          yield* process.session.abort(resumed.sessionId);
        }),
      60000,
    );

    it.effect(
      "PiAgent carries acquisition-scoped callbacks through create and resume and tool errors stay errors",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const dir = yield* fs.makeTempDirectoryScoped();
          vi.stubEnv("PI_CODING_AGENT_DIR", dir);
          const process = yield* makePiProcess({
            executable: { command: globalThis.process.execPath, prefixArgs: [cli] },
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
          const pi = makePiAgent(process, {
            executable: { command: globalThis.process.execPath, prefixArgs: [cli] },
          });
          const callbacks: PiSessionToolsShape = {
            list: Effect.succeed([]),
            register: () => Effect.fail(new Error("private failure")),
            exclude: () => Effect.void,
          };
          const created = yield* pi
            .create({ cwd: dir, provider: "registration-test", modelId: "model" })
            .pipe(Effect.provideService(PiSessionTools, callbacks));
          yield* created.prompt({
            parts: [
              {
                type: "text",
                text: JSON.stringify({
                  tool: "session_register_pull_request",
                  input: { url: prUrl },
                }),
              },
            ],
          });
          const events = yield* Stream.runCollect(
            created.events.pipe(
              Stream.takeUntil((event) => event.body.type === "session.turn.ended"),
            ),
          );
          assert.ok(events.some((event) => event.body.type === "tool-output-error"));
          assert.equal(JSON.stringify(events).includes("private failure"), false);
          yield* created.close;
          const resumed = yield* pi
            .resume({ sessionId: created.sessionId, cwd: dir })
            .pipe(Effect.provideService(PiSessionTools, callbacks));
          yield* resumed.prompt({
            parts: [
              {
                type: "text",
                text: JSON.stringify({ tool: "session_list_pull_requests", input: {} }),
              },
            ],
          });
          const resumedEvents = yield* Stream.runCollect(
            resumed.events.pipe(
              Stream.takeUntil((event) => event.body.type === "session.turn.ended"),
            ),
          );
          assert.ok(resumedEvents.some((event) => event.body.type === "tool-output-available"));
          yield* resumed.close;
        }),
      60000,
    );
  },
);

layer(NodeServices.layer, { excludeTestServices: true })("bridge process lifecycle", (it) => {
  it.effect(
    "revokes credentials after close, crash, and child startup failure, then rotates on resume",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        vi.stubEnv("PI_CODING_AGENT_DIR", dir);
        const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const spawned: { endpoint: string; token: string; extension: string }[] = [];
        const observer = ChildProcessSpawner.make((command) => {
          if (command._tag === "StandardCommand") {
            const endpoint = command.options.env?.PIE_SESSION_BRIDGE_URL;
            const token = command.options.env?.PIE_SESSION_BRIDGE_TOKEN;
            const extension = command.args.at(-1);
            assert.ok(endpoint && token && extension);
            assert.equal(command.options.env?.PIE_AUTH_TOKEN, undefined);
            spawned.push({ endpoint, token, extension });
          }
          return realSpawner.spawn(command);
        });
        const callbacks: PiSessionToolsShape = {
          list: Effect.succeed([]),
          register: () => Effect.succeed("linked"),
          exclude: () => Effect.void,
        };
        const pi = yield* makePiProcess({
          executable: { command: globalThis.process.execPath, prefixArgs: [cli] },
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
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observer));
        const first = yield* pi.session.create({
          cwd: dir,
          provider: "registration-test",
          modelId: "model",
          tools: callbacks,
        });
        yield* pi.session.abort(first.sessionId);
        const opened = spawned[0];
        if (!opened) throw new Error("missing bridge");
        assert.equal(yield* fs.exists(opened.extension), false);
        const resumed = yield* pi.session.resume({
          cwd: dir,
          sessionId: first.sessionId,
          tools: callbacks,
        });
        const resumedBridge = spawned[1];
        if (!resumedBridge) throw new Error("missing resumed bridge");
        assert.notEqual(opened.token, resumedBridge.token);
        const mismatch = yield* Effect.tryPromise(() =>
          fetch(`${resumedBridge.endpoint}/list`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${opened.token}`,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        );
        assert.equal(mismatch.status, 403);
        yield* pi.session
          .prompt({ sessionId: resumed.sessionId, text: "/registration-crash" })
          .pipe(Effect.ignore);
        yield* pi.session.awaitTermination(resumed.sessionId).pipe(Effect.ignore);
        // Crash cleanup closes the child scope on a separate owner fiber.
        yield* Effect.sleep("100 millis");
        assert.equal(yield* fs.exists(resumedBridge.extension), false);
        const failed = yield* makePiProcess({
          executable: {
            command: globalThis.process.execPath,
            prefixArgs: ["/missing-pie-test-cli.js"],
          },
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observer));
        assert.equal(
          yield* failed.session.create({ cwd: dir, tools: callbacks }).pipe(Effect.isFailure),
          true,
        );
        const failedBridge = spawned[2];
        if (!failedBridge) throw new Error("missing failed bridge");
        assert.equal(yield* fs.exists(failedBridge.extension), false);
        for (const child of spawned) {
          assert.equal(
            yield* Effect.tryPromise(() =>
              fetch(`${child.endpoint}/list`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${child.token}`,
                  "content-type": "application/json",
                },
                body: "{}",
              }),
            ).pipe(Effect.isFailure),
            true,
          );
        }
      }),
    60000,
  );
});
