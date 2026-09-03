import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vitest";

import {
  collectSshConfigAliasesFromFile,
  parseKnownHostsHostnames,
  resolveSshConfigIncludePattern,
} from "./config";

const withTmp = <A>(
  f: (dir: string) => Effect.Effect<A, unknown, FileSystem.FileSystem>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* Effect.orDie(fs.makeTempDirectoryScoped());
      return yield* f(dir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

describe("parseKnownHostsHostnames", () => {
  it("reads hostnames and strips bracketed ports", () => {
    expect(
      parseKnownHostsHostnames(
        [
          "example.com ssh-ed25519 AAAA",
          "[192.168.1.8]:2222 ssh-ed25519 BBBB",
          "|1|hashed ssh-ed25519 CCCC",
          "# comment",
        ].join("\n"),
      ),
    ).toEqual(["192.168.1.8", "example.com"]);
  });
});

describe("ssh config discovery", () => {
  it("resolves Include patterns relative to ~/.ssh", () => {
    expect(resolveSshConfigIncludePattern("config.d/*", "/home/alice")).toBe(
      path.resolve("/home/alice/.ssh/config.d/*"),
    );
    expect(resolveSshConfigIncludePattern("/opt/ssh/extra", "/home/alice")).toBe("/opt/ssh/extra");
  });

  it("collects Host aliases and follows Include, skipping patterns", async () => {
    const aliases = await withTmp((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sshDir = path.join(dir, ".ssh");
        const includeDir = path.join(sshDir, "config.d");
        yield* fs.makeDirectory(includeDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(sshDir, "config"),
          ["Host myserver", "  HostName example.com", "Include config.d/*", "Host *"].join("\n"),
        );
        yield* fs.writeFileString(path.join(includeDir, "extra"), "Host extra-box\n");
        return yield* collectSshConfigAliasesFromFile(path.join(sshDir, "config"), new Set(), dir);
      }),
    );

    expect(aliases).toEqual(["extra-box", "myserver"]);
  });
});
