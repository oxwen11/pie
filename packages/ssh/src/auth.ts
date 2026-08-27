import os from "node:os";
import path from "node:path";

import { Context, Effect, FileSystem, Layer, type PlatformError } from "effect";

import { SshPasswordPromptError } from "./errors";

export type SshPasswordRequest = {
  readonly destination: string;
  readonly username: string | null;
  readonly prompt: string;
  readonly attempt: number;
};

export type SshAskpassFile = {
  readonly path: string;
  readonly contents: string;
  readonly mode?: number;
};

export type SshAskpassHelperDescriptor = {
  readonly launcherPath: string;
  readonly files: ReadonlyArray<SshAskpassFile>;
};

export type SshAuthOptions = {
  readonly authSecret?: string | null;
  readonly batchMode?: "yes" | "no";
  readonly interactiveAuth?: boolean;
};

export type SshPasswordPromptShape = {
  readonly isAvailable: boolean;
  readonly request: (
    request: SshPasswordRequest,
  ) => Effect.Effect<string | null, SshPasswordPromptError>;
};

export class SshPasswordPrompt extends Context.Service<SshPasswordPrompt, SshPasswordPromptShape>()(
  "@getpie/ssh/auth/SshPasswordPrompt",
) {
  static readonly disabledLayer = Layer.succeed(
    SshPasswordPrompt,
    SshPasswordPrompt.of({
      isAvailable: false,
      request: () => Effect.succeed(null),
    }),
  );
}

export type SshChildEnvironmentOptions = {
  readonly interactiveAuth?: boolean;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly askpassDirectory?: string;
  readonly authSecret?: string | null;
};

const SSH_ASKPASS_DIR_NAME = "pie-ssh-askpass";

export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
# Invoked by ssh via SSH_ASKPASS when pie re-runs ssh with a cached password
# from the in-app prompt. Missing PIE_SSH_AUTH_SECRET is a caller bug.
if [ "\${PIE_SSH_AUTH_SECRET+x}" = "x" ]; then
  printf "%s\\n" "$PIE_SSH_AUTH_SECRET"
  exit 0
fi
printf 'pie ssh-askpass invoked without PIE_SSH_AUTH_SECRET.\\n' >&2
exit 1
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

export const ASKPASS_WINDOWS_SCRIPT = `if ($null -ne $env:PIE_SSH_AUTH_SECRET) {\r
  [Console]::Out.WriteLine($env:PIE_SSH_AUTH_SECRET)\r
  exit 0\r
}\r
[Console]::Error.WriteLine("pie ssh-askpass invoked without PIE_SSH_AUTH_SECRET.")\r
exit 1\r
`;

function joinAskpassPath(directory: string, fileName: string, platform: NodeJS.Platform): string {
  const trimmed = directory.replace(/[\\/]+$/u, "");
  return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
}

export const getDefaultSshAskpassDirectory = (
  directory?: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (directory) return directory;
    const fs = yield* FileSystem.FileSystem;
    const parent = yield* fs.makeTempDirectory({ prefix: "pie-ssh-runtime-" });
    return path.join(parent, SSH_ASKPASS_DIR_NAME);
  });

export function buildSshAskpassHelperDescriptor(directory: string): SshAskpassHelperDescriptor {
  const platform = os.platform();
  if (platform === "win32") {
    return {
      launcherPath: joinAskpassPath(directory, "ssh-askpass.cmd", platform),
      files: [
        {
          path: joinAskpassPath(directory, "ssh-askpass.cmd", platform),
          contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT,
        },
        {
          path: joinAskpassPath(directory, "ssh-askpass.ps1", platform),
          contents: ASKPASS_WINDOWS_SCRIPT,
        },
      ],
    };
  }

  return {
    launcherPath: path.join(directory, "ssh-askpass.sh"),
    files: [
      {
        path: path.join(directory, "ssh-askpass.sh"),
        contents: ASKPASS_POSIX_SCRIPT,
        mode: 0o700,
      },
    ],
  };
}

export const ensureSshAskpassHelpers = (
  directory: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const descriptor = buildSshAskpassHelperDescriptor(directory);
    yield* fs.makeDirectory(path.dirname(descriptor.launcherPath), { recursive: true });

    for (const file of descriptor.files) {
      const existing = yield* fs.exists(file.path);
      const current = existing ? yield* fs.readFileString(file.path) : null;
      if (current !== file.contents) {
        yield* fs.writeFileString(file.path, file.contents);
      }
      if (file.mode !== undefined && os.platform() !== "win32") {
        yield* fs.chmod(file.path, file.mode);
      }
    }

    return descriptor.launcherPath;
  });

export const buildSshChildEnvironment = (
  input: SshChildEnvironmentOptions = {},
): Effect.Effect<NodeJS.ProcessEnv, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const baseEnv = { ...input.baseEnv };
    if (!input.interactiveAuth) return baseEnv;

    const platform = os.platform();
    const directory = yield* getDefaultSshAskpassDirectory(input.askpassDirectory);
    const sshAskpass = yield* ensureSshAskpassHelpers(directory);

    const environment: NodeJS.ProcessEnv = {
      ...baseEnv,
      SSH_ASKPASS: sshAskpass,
      SSH_ASKPASS_REQUIRE: "force",
    };
    if (input.authSecret !== undefined) {
      environment.PIE_SSH_AUTH_SECRET = input.authSecret ?? "";
    }
    if (platform !== "win32" && !baseEnv.DISPLAY) {
      environment.DISPLAY = "pie";
    }
    return environment;
  });

export function isSshAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    /permission denied \((?:publickey|password|keyboard-interactive|hostbased|gssapi-with-mic)[^)]*\)/u.test(
      normalized,
    ) ||
    /authentication failed/u.test(normalized) ||
    /too many authentication failures/u.test(normalized)
  );
}
