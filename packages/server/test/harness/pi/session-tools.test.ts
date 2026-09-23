import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import type { PullRequestRef } from "@getpie/contract/pull-request";
import { Deferred, Effect, Exit, Fiber, FileSystem, Scope } from "effect";
import { describe, expect, it as test } from "vitest";

import {
  makePiSessionToolsBridge,
  parseSessionPullRequestUrl,
  type PiSessionToolsShape,
} from "../../../src/harness/pi/session-tools";

const url = "https://github.com/Owner/Repo/pull/42";
const ref: PullRequestRef = { host: "github.com", owner: "owner", repository: "repo", number: 42 };
const emptyTools: PiSessionToolsShape = {
  list: Effect.succeed([]),
  register: () => Effect.succeed("linked"),
  exclude: () => Effect.void,
};
type Bridge = Effect.Success<ReturnType<typeof makePiSessionToolsBridge>>;
const request = (
  bridge: Bridge,
  operation: string,
  input: unknown,
  headers?: Record<string, string>,
) =>
  Effect.tryPromise(() =>
    fetch(`${bridge.env.PIE_SESSION_BRIDGE_URL}/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bridge.env.PIE_SESSION_BRIDGE_TOKEN}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(input),
    }),
  );

describe("PR identity validation", () => {
  test("normalizes a known GitHub identity offline", () => {
    expect(parseSessionPullRequestUrl(url)).toEqual(ref);
  });
  test.each([
    "http://github.com/a/b/pull/1",
    "https://github.com.evil/a/b/pull/1",
    "https://user:pass@github.com/a/b/pull/1",
    "https://github.com:443/a/b/pull/1",
    "https://example.com/a/b/pull/1",
    "https://github.com/a/../pull/1",
    "https://github.com/a/%2E%2E/pull/1",
    "https://github.com/a/b/pull/0",
    "https://github.com/a/b/pull/-1",
    "https://github.com/a/b/pull/1?x=y",
    "https://github.com/a/b/pull/1#x",
    "https://github.com/a/b/pull/9007199254740993",
  ])("rejects unsafe identity %s", (input) => {
    expect(() => parseSessionPullRequestUrl(input)).toThrow(/Invalid GitHub PR/);
  });
});

layer(NodeServices.layer, { excludeTestServices: true })("scoped session bridge", (it) => {
  it.effect("rejects unauthorized, cross-session, browser and arbitrary-session requests", () =>
    Effect.gen(function* () {
      let calls = 0;
      const tools: PiSessionToolsShape = {
        ...emptyTools,
        register: () =>
          Effect.sync(() => {
            calls++;
            return "linked" as const;
          }),
      };
      const a = yield* makePiSessionToolsBridge(tools);
      const b = yield* makePiSessionToolsBridge(emptyTools);
      const rejectedHeaders: Record<string, string>[] = [
        { authorization: "" },
        { authorization: "Bearer wrong" },
        { authorization: `Bearer ${b.env.PIE_SESSION_BRIDGE_TOKEN}` },
        { origin: "https://evil.example" },
      ];
      for (const headers of rejectedHeaders)
        assert.equal(
          (yield* request(a, "register", { url }, headers)).status,
          403,
          Object.keys(headers).join(","),
        );
      for (const input of [
        { url, sessionId: "other" },
        { url, ref: { projectId: "other", sessionId: "other" } },
        { url, source: "stack" },
        { url: "https://evil.example/a/b/pull/1" },
      ]) {
        assert.equal((yield* request(a, "register", input)).status, 400);
      }
      assert.equal((yield* request(a, "merge", { url })).status, 404);
      assert.equal((yield* request(a, "register?token=wrong", { url })).status, 404);
      assert.equal(
        yield* request(a, "register", { url: "x".repeat(5000) }).pipe(
          Effect.match({ onSuccess: (response) => response.status === 400, onFailure: () => true }),
        ),
        true,
      );
      const badHost = yield* Effect.tryPromise(
        () =>
          new Promise<number | undefined>((resolve, reject) => {
            const req = http.request(
              `${a.env.PIE_SESSION_BRIDGE_URL}/register`,
              {
                method: "POST",
                headers: {
                  host: "evil.example",
                  authorization: `Bearer ${a.env.PIE_SESSION_BRIDGE_TOKEN}`,
                  "content-type": "application/json",
                },
              },
              (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode));
              },
            );
            req.on("error", reject);
            req.end(JSON.stringify({ url }));
          }),
      );
      assert.equal(badHost, 403);
      assert.equal(calls, 0);
      assert.equal((yield* request(a, "register", { url })).status, 200);
      assert.equal(calls, 1);
    }),
  );

  it.effect(
    "does not ACK until the durable callback completes, and forwards explicit restore",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const started = yield* Deferred.make<void>();
        const persist = yield* Deferred.make<void>();
        let acknowledged = false;
        const bridge = yield* makePiSessionToolsBridge({
          ...emptyTools,
          register: (identity, restore) =>
            Effect.gen(function* () {
              assert.deepEqual(identity, ref);
              assert.equal(restore, true);
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(persist);
              yield* fs.writeFileString(path.join(dir, "saved.json"), JSON.stringify(identity));
              return "linked" as const;
            }),
        });
        const response = yield* request(bridge, "register", { url, restore: true }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              acknowledged = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        assert.equal(acknowledged, false);
        assert.equal(yield* fs.exists(path.join(dir, "saved.json")), false);
        yield* Deferred.succeed(persist, undefined);
        assert.equal((yield* Fiber.join(response)).status, 200);
        assert.deepEqual(JSON.parse(yield* fs.readFileString(path.join(dir, "saved.json"))), ref);
      }),
  );

  it.effect(
    "preserves exists/excluded results and reports write/read failures without leaking details",
    () =>
      Effect.gen(function* () {
        const bridge = yield* makePiSessionToolsBridge({
          list: Effect.fail(new Error("secret internal path")),
          register: (_ref, restore) => Effect.succeed(restore ? "exists" : "excluded"),
          exclude: () => Effect.fail(new Error("secret internal path")),
        });
        for (const [restore, status] of [
          [false, "excluded"],
          [true, "exists"],
        ] as const) {
          const response = yield* request(bridge, "register", { url, restore });
          assert.deepEqual(yield* Effect.promise(() => response.json()), { ref, status });
        }
        for (const operation of ["list", "exclude"]) {
          const response = yield* request(bridge, operation, operation === "list" ? {} : { url });
          assert.equal(response.status, 400);
          assert.equal(yield* Effect.promise(() => response.text()), "");
        }
      }),
  );

  it.effect("revokes the endpoint and removes the extension when its scope closes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const scope = yield* Scope.make();
      const bridge = yield* makePiSessionToolsBridge(emptyTools).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const extension = bridge.args[1];
      if (!extension) throw new Error("missing extension");
      assert.equal((yield* fs.stat(extension)).mode & 0o777, 0o600);
      assert.equal((yield* fs.stat(path.dirname(extension))).mode & 0o777, 0o700);
      yield* Scope.close(scope, Exit.void);
      assert.equal(yield* fs.exists(extension), false);
      assert.equal(yield* request(bridge, "list", {}).pipe(Effect.isFailure), true);
    }),
  );
});
