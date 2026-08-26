import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vitest";

import { ASKPASS_POSIX_SCRIPT, isSshAuthFailure } from "./auth";
import {
  baseSshArgs,
  findSshCommand,
  isSshSpawnNotFound,
  normalizeSshErrorMessage,
  probeSshClient,
  redactSshErrorOutput,
  requireSshCommand,
  SSH_UNSET_ENV_KEYS,
  sshClientMissingMessage,
  sshCommandForPlatform,
  sshSpawnEnv,
} from "./command";
import { parseSshInput } from "./target";

describe("ssh command helpers", () => {
  it("selects ssh.exe on Windows", () => {
    expect(sshCommandForPlatform("win32")).toBe("ssh.exe");
    expect(sshCommandForPlatform("linux")).toBe("ssh");
  });

  it("explains a missing client for the host platform", () => {
    expect(sshClientMissingMessage("ssh.exe", "win32")).toContain("Optional Features");
    expect(sshClientMissingMessage("ssh", "linux")).toContain("PATH");
  });

  it("treats ENOENT and nested NotFound as a missing spawn", () => {
    expect(isSshSpawnNotFound({ code: "ENOENT" })).toBe(true);
    expect(isSshSpawnNotFound({ cause: { reason: "NotFound" } })).toBe(true);
    expect(isSshSpawnNotFound({ code: "EACCES" })).toBe(false);
  });

  it("adds BatchMode and an explicit port", () => {
    expect(baseSshArgs(parseSshInput("alice@example.com:2222"), { batchMode: "yes" })).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      "2222",
    ]);
  });

  it("redacts token fields in SSH error stdout", () => {
    expect(redactSshErrorOutput('{"token":"super-secret","remotePort":4000}')).toBe(
      '{"token":"[redacted]","remotePort":4000}',
    );
  });

  it("prefers stderr when normalizing a failure message", () => {
    expect(
      normalizeSshErrorMessage({
        stdout: "ignored",
        stderr: "Permission denied (publickey).",
        fallbackMessage: "failed",
      }),
    ).toBe("Permission denied (publickey).");
  });
});

describe("sshSpawnEnv", () => {
  it("strips pie and Electron variables so they cannot SendEnv to the remote", () => {
    const env = sshSpawnEnv({
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent",
      NODE_ENV: "development",
      PIE_HOME: "/tmp/pie-dev",
      PIE_AUTH_TOKEN: "secret",
      HOME: "/home/user",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/agent");
    expect(env.HOME).toBe("/home/user");
    for (const key of SSH_UNSET_ENV_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });
});

describe("isSshAuthFailure", () => {
  it("detects publickey and keyboard-interactive denials", () => {
    expect(isSshAuthFailure("Permission denied (publickey).")).toBe(true);
    expect(isSshAuthFailure("Permission denied (keyboard-interactive,publickey).")).toBe(true);
    expect(isSshAuthFailure("Too many authentication failures")).toBe(true);
    expect(isSshAuthFailure("Host key verification failed.")).toBe(false);
  });
});

describe("askpass helper", () => {
  it("prints PIE_SSH_AUTH_SECRET when the posix helper is invoked", () => {
    expect(ASKPASS_POSIX_SCRIPT).toContain("PIE_SSH_AUTH_SECRET");
    expect(ASKPASS_POSIX_SCRIPT.startsWith("#!/bin/sh")).toBe(true);
  });
});

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

describe("findSshCommand", () => {
  it("resolves ssh on PATH and ignores installs outside PATH", async () => {
    const result = await withTmp((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const onPath = path.join(dir, "bin");
        const offPath = path.join(dir, "hidden");
        yield* fs.makeDirectory(onPath, { recursive: true });
        yield* fs.makeDirectory(offPath, { recursive: true });
        const visible = path.join(onPath, "ssh");
        const hidden = path.join(offPath, "ssh");
        yield* fs.writeFileString(visible, "#!/bin/sh\n");
        yield* fs.writeFileString(hidden, "#!/bin/sh\n");
        yield* fs.chmod(visible, 0o755);
        yield* fs.chmod(hidden, 0o755);
        return {
          found: yield* findSshCommand({ env: { PATH: onPath }, platform: "linux" }),
          expected: visible,
        };
      }),
    );
    expect(result.found).toBe(result.expected);
  });

  it("reports missing when PATH has no ssh binary", async () => {
    const result = await withTmp((dir) =>
      Effect.gen(function* () {
        const empty = path.join(dir, "empty");
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(empty, { recursive: true });
        const missing = yield* findSshCommand({ env: { PATH: empty }, platform: "linux" });
        const requiredTag = yield* requireSshCommand({
          env: { PATH: empty },
          platform: "linux",
        }).pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "available" }));
        const probed = yield* probeSshClient({ env: { PATH: empty }, platform: "linux" });
        return { missing, requiredTag, probed };
      }),
    );
    expect(result.missing).toBeUndefined();
    expect(result.probed).toEqual({
      available: false,
      message: sshClientMissingMessage("ssh", "linux"),
    });
    expect(result.requiredTag).toBe("SshClientMissingError");
  });
});
