import path from "node:path";

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { sshEnvironmentsFile } from "@getpie/server/daemon";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import { makeDesktopSsh } from "./desktop-ssh";

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
});
