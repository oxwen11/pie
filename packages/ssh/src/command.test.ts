import { describe, expect, it } from "vitest";

import { ASKPASS_POSIX_SCRIPT, isSshAuthFailure } from "./auth";
import {
  baseSshArgs,
  normalizeSshErrorMessage,
  redactSshErrorOutput,
  SSH_UNSET_ENV_KEYS,
  sshCommandForPlatform,
  sshSpawnEnv,
} from "./command";
import { parseSshInput } from "./target";

describe("ssh command helpers", () => {
  it("selects ssh.exe on Windows", () => {
    expect(sshCommandForPlatform("win32")).toBe("ssh.exe");
    expect(sshCommandForPlatform("linux")).toBe("ssh");
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
