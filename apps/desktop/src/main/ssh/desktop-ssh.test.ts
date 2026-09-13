import path from "node:path";

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { sshEnvironmentsFile } from "@getpie/server/daemon";
import { parseSshInput, type SshConnectedEnvironment, type SshTarget } from "@getpie/ssh";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import { makeDesktopSsh } from "./desktop-ssh";

function fakeConnected(target: SshTarget): SshConnectedEnvironment {
  return {
    target,
    httpBaseUrl: "http://127.0.0.1:1",
    wsBaseUrl: "ws://127.0.0.1:1",
    token: "tok",
    remotePort: 4000,
    close: Effect.void,
    closed: Effect.never,
    alive: Effect.succeed(true),
  };
}

const nodeBase = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const platform = Layer.mergeAll(
  nodeBase,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(nodeBase)),
);

const withSsh = <A>(
  f: (
    dir: string,
  ) => Effect.Effect<A, unknown, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* Effect.orDie(fs.makeTempDirectoryScoped());
      return yield* f(dir);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

describe("DesktopSsh saved hosts", () => {
  it("keeps saved hosts under PIE_HOME storage, not Electron userData", () => {
    expect(sshEnvironmentsFile("/Users/me/.pie")).toBe(
      "/Users/me/.pie/storage/ssh-environments.json",
    );
  });

  it("returns no hosts when the persist file is missing", async () => {
    const saved = await withSsh((dir) =>
      Effect.gen(function* () {
        const ssh = yield* makeDesktopSsh({ persistPath: path.join(dir, "ssh-environments.json") });
        return yield* ssh.listSaved;
      }),
    );
    expect(saved).toEqual([]);
  });

  it("reads version-1 hosts and skips malformed entries", async () => {
    const saved = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          path.join(dir, "ssh-environments.json"),
          JSON.stringify({
            version: 1,
            data: {
              environments: [
                {
                  id: "abc123abc123abcd",
                  alias: "myserver",
                  hostname: "example.com",
                  username: "alice",
                  port: 2222,
                },
                { id: "", alias: "bad" },
                {
                  id: "deadbeefdeadbeef",
                  alias: "other",
                  hostname: "other.example",
                  username: null,
                  port: null,
                },
              ],
            },
          }),
        );
        const ssh = yield* makeDesktopSsh({ persistPath: path.join(dir, "ssh-environments.json") });
        return yield* ssh.listSaved;
      }),
    );

    expect(saved).toEqual([
      {
        id: "abc123abc123abcd",
        target: {
          alias: "myserver",
          hostname: "example.com",
          username: "alice",
          port: 2222,
        },
      },
      {
        id: "deadbeefdeadbeef",
        target: {
          alias: "other",
          hostname: "other.example",
          username: null,
          port: null,
        },
      },
    ]);
  });

  it("still reads a pre-envelope version-1 file", async () => {
    const saved = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          path.join(dir, "ssh-environments.json"),
          JSON.stringify({
            version: 1,
            activeId: "abc123abc123abcd",
            environments: [
              {
                id: "abc123abc123abcd",
                alias: "myserver",
                hostname: "example.com",
                username: "alice",
                port: 22,
              },
            ],
          }),
        );
        const ssh = yield* makeDesktopSsh({ persistPath: path.join(dir, "ssh-environments.json") });
        return yield* ssh.listSaved;
      }),
    );
    expect(saved).toEqual([
      {
        id: "abc123abc123abcd",
        target: {
          alias: "myserver",
          hostname: "example.com",
          username: "alice",
          port: 22,
        },
      },
    ]);
  });

  it("remove deletes a saved host from disk", async () => {
    const remaining = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          path.join(dir, "ssh-environments.json"),
          `${JSON.stringify({
            version: 1,
            data: {
              environments: [
                {
                  id: "keep-me-keep-meok",
                  alias: "keep",
                  hostname: "keep.example",
                  username: null,
                  port: null,
                },
                {
                  id: "drop-me-drop-meok",
                  alias: "drop",
                  hostname: "drop.example",
                  username: null,
                  port: null,
                },
              ],
            },
          })}\n`,
        );
        const ssh = yield* makeDesktopSsh({ persistPath: path.join(dir, "ssh-environments.json") });
        yield* ssh.remove("drop-me-drop-meok");
        return yield* ssh.listSaved;
      }),
    );

    expect(remaining.map((entry) => entry.id)).toEqual(["keep-me-keep-meok"]);
  });

  it("writes hosts without an activeId or token", async () => {
    const written = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(dir, "ssh-environments.json");
        yield* fs.writeFileString(
          file,
          JSON.stringify({
            version: 1,
            data: {
              environments: [
                {
                  id: "keep-me-keep-meok",
                  alias: "keep",
                  hostname: "keep.example",
                  username: null,
                  port: null,
                },
                {
                  id: "drop-me-drop-meok",
                  alias: "drop",
                  hostname: "drop.example",
                  username: null,
                  port: null,
                },
              ],
            },
          }),
        );
        const ssh = yield* makeDesktopSsh({ persistPath: file });
        yield* ssh.remove("drop-me-drop-meok");
        return yield* fs.readFileString(file);
      }),
    );
    const parsed: unknown = JSON.parse(written);
    expect(parsed).toEqual({
      version: 1,
      data: {
        environments: [
          {
            id: "keep-me-keep-meok",
            alias: "keep",
            hostname: "keep.example",
            username: null,
            port: null,
          },
        ],
      },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/activeId/i);
    expect(JSON.stringify(parsed)).not.toMatch(/token/i);
  });

  it("keeps both hosts when two connects persist concurrently", async () => {
    const saved = await withSsh((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "ssh-environments.json");
        const ssh = yield* makeDesktopSsh({
          persistPath: file,
          resolveInput: (raw) => Effect.succeed(parseSshInput(raw)),
          connectEnvironment: (target) =>
            Effect.sleep("30 millis").pipe(Effect.as(fakeConnected(target))),
          loadEnvironmentId: () => Effect.succeed("env-1"),
        });
        yield* Effect.all([ssh.connect("alice@one.example"), ssh.connect("bob@two.example")], {
          concurrency: 2,
        });
        const fs = yield* FileSystem.FileSystem;
        const written = yield* fs.readFileString(file);
        return { list: yield* ssh.listSaved, written };
      }),
    );

    expect(saved.list.map((entry) => entry.target.username)).toEqual(
      expect.arrayContaining(["alice", "bob"]),
    );
    expect(saved.list).toHaveLength(2);
    const parsed: unknown = JSON.parse(saved.written);
    const ids =
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      typeof parsed.data === "object" &&
      parsed.data !== null &&
      "environments" in parsed.data &&
      Array.isArray(parsed.data.environments)
        ? parsed.data.environments.map((entry: { id?: unknown }) => entry.id)
        : [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("returns the environment id from one GET after the tunnel is up", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      return Response.json({ id: "env-from-get" });
    }) as typeof fetch;
    try {
      const result = await withSsh((dir) =>
        Effect.gen(function* () {
          const ssh = yield* makeDesktopSsh({
            persistPath: path.join(dir, "ssh-environments.json"),
            resolveInput: (raw) => Effect.succeed(parseSshInput(raw)),
            connectEnvironment: (target) => Effect.succeed(fakeConnected(target)),
          });
          return yield* ssh.connect("alice@example.com");
        }),
      );
      expect(result.environmentId).toBe("env-from-get");
      expect(calls).toEqual(["http://127.0.0.1:1/api/environment"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails connect when the saved hosts file cannot be written", async () => {
    const error = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const blocker = path.join(dir, "not-a-directory");
        yield* fs.writeFileString(blocker, "x");
        const ssh = yield* makeDesktopSsh({
          persistPath: path.join(blocker, "ssh-environments.json"),
          resolveInput: (raw) => Effect.succeed(parseSshInput(raw)),
          connectEnvironment: (target) => Effect.succeed(fakeConnected(target)),
          loadEnvironmentId: () => Effect.succeed("env-1"),
        });
        return yield* ssh.connect("alice@example.com").pipe(Effect.flip);
      }),
    );
    expect(error._tag).toBe("SshPersistError");
  });

  it("fails remove when the saved hosts file cannot be written", async () => {
    const error = await withSsh((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(dir, "ssh-environments.json");
        yield* fs.writeFileString(
          file,
          `${JSON.stringify({
            version: 1,
            data: {
              environments: [
                {
                  id: "drop-me-drop-meok",
                  alias: "drop",
                  hostname: "drop.example",
                  username: null,
                  port: null,
                },
              ],
            },
          })}\n`,
        );
        const ssh = yield* makeDesktopSsh({ persistPath: file });
        yield* fs.remove(file);
        yield* fs.makeDirectory(file);
        return yield* ssh.remove("drop-me-drop-meok").pipe(Effect.flip);
      }),
    );
    expect(error._tag).toBe("SshPersistError");
  });
});
