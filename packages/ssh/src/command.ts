import os from "node:os";

import { Duration, Effect, FileSystem, Option, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { buildSshChildEnvironment, type SshAuthOptions } from "./auth";
import { SshCommandError, SshInvalidTargetError } from "./errors";
import {
  buildSshHostSpecEffect,
  getLastNonEmptyOutputLine,
  overlaySshTarget,
  parseSshInput,
  parseSshResolveOutput,
  type SshTarget,
} from "./target";

const DEFAULT_SSH_COMMAND_TIMEOUT_MS = 60_000;
const MAX_SSH_ERROR_OUTPUT_LENGTH = 4_000;
const encoder = new TextEncoder();

/** Local process env that must not leak to `ssh` (SendEnv) or a remote pie. */
export const SSH_UNSET_ENV_KEYS = [
  "NODE_ENV",
  "PIE_HOME",
  "PIE_DAEMON_DIR",
  "PIE_AUTH_TOKEN",
  "PIE_PORT",
  "PIE_CORS_ORIGINS",
  "PIE_E2E",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_URL",
] as const;

/** Inherited env for an `ssh` child, with pie/Electron secrets stripped. */
export function sshSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of SSH_UNSET_ENV_KEYS) {
    delete env[key];
  }
  return { ...env, ...extra };
}

export type SshCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export type RunSshCommandOptions = SshAuthOptions & {
  readonly preHostArgs?: ReadonlyArray<string>;
  readonly remoteCommandArgs?: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
};

export function sshCommandForPlatform(platform: NodeJS.Platform = os.platform()): string {
  return platform === "win32" ? "ssh.exe" : "ssh";
}

export function baseSshArgs(
  target: SshTarget,
  input?: { readonly batchMode?: "yes" | "no" },
): string[] {
  return [
    "-o",
    `BatchMode=${input?.batchMode ?? "no"}`,
    "-o",
    "ConnectTimeout=10",
    ...(target.port !== null ? ["-p", String(target.port)] : []),
  ];
}

function sshTargetLogFields(target: SshTarget) {
  return {
    alias: target.alias,
    hostname: target.hostname,
    username: target.username,
    port: target.port,
  };
}

export function redactSshErrorOutput(output: string): string {
  const redacted = output.replace(
    /("(?:access_token|bearerToken|credential|pairingToken|token)"\s*:\s*")[^"]+(")/giu,
    "$1[redacted]$2",
  );
  return redacted.length > MAX_SSH_ERROR_OUTPUT_LENGTH
    ? `${redacted.slice(0, MAX_SSH_ERROR_OUTPUT_LENGTH)}\n[truncated]`
    : redacted;
}

export function normalizeSshErrorMessage(input: {
  readonly stdout?: string;
  readonly stderr: string;
  readonly fallbackMessage: string;
}): string {
  const cleanedStderr = input.stderr.trim();
  if (cleanedStderr.length > 0) return cleanedStderr;
  const cleanedStdout = input.stdout?.trim() ?? "";
  return cleanedStdout.length > 0 ? cleanedStdout : input.fallbackMessage;
}

const collectProcessOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

function stdinStream(input: string | undefined) {
  return input === undefined ? Stream.empty : Stream.make(encoder.encode(input));
}

const runSshCommandInScope = (
  target: SshTarget,
  input: RunSshCommandOptions,
  commandScope: Scope.Scope,
): Effect.Effect<
  SshCommandResult,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const hostSpec = yield* buildSshHostSpecEffect(target);
    const environment = yield* buildSshChildEnvironment({
      baseEnv: sshSpawnEnv(),
      ...(input.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
      ...(input.authSecret === undefined ? {} : { authSecret: input.authSecret }),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new SshCommandError({
            command: ["ssh"],
            exitCode: null,
            stderr: "",
            message: "Failed to prepare SSH authentication helpers.",
            cause,
          }),
      ),
    );
    const args = [
      ...baseSshArgs(target, {
        batchMode: input.batchMode ?? (input.interactiveAuth ? "no" : "yes"),
      }),
      ...(input.preHostArgs ?? []),
      hostSpec,
      ...(input.remoteCommandArgs ?? []),
    ];
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sshCommand = sshCommandForPlatform();
    yield* Effect.logDebug("ssh.command.start").pipe(
      Effect.annotateLogs({
        ...sshTargetLogFields(target),
        command: [sshCommand, ...args],
        hasStdin: input.stdin !== undefined,
        timeoutMs: input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS,
      }),
    );
    const child = yield* spawner
      .spawn(
        ChildProcess.make(sshCommand, args, {
          env: environment,
          extendEnv: false,
          stdin: {
            stream: stdinStream(input.stdin),
            endOnDone: true,
          },
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, commandScope),
        Effect.mapError(
          (cause) =>
            new SshCommandError({
              command: [sshCommand, ...args],
              exitCode: null,
              stderr: "",
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to spawn SSH command for ${hostSpec}.`,
              cause,
            }),
        ),
      );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectProcessOutput(child.stdout),
        collectProcessOutput(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SshCommandError({
            command: ["ssh", ...args],
            exitCode: null,
            stderr: "",
            message:
              cause instanceof Error ? cause.message : `Failed to run SSH command for ${hostSpec}.`,
            cause,
          }),
      ),
    );

    if (exitCode !== 0) {
      const diagnosticStdout = redactSshErrorOutput(stdout);
      yield* Effect.logWarning("ssh.command.failed").pipe(
        Effect.annotateLogs({
          ...sshTargetLogFields(target),
          command: ["ssh", ...args],
          exitCode,
          stdout: diagnosticStdout,
          stderr,
        }),
      );
      return yield* new SshCommandError({
        command: ["ssh", ...args],
        exitCode,
        stdout: diagnosticStdout,
        stderr,
        message: normalizeSshErrorMessage({
          stdout: diagnosticStdout,
          stderr,
          fallbackMessage: `SSH command failed for ${hostSpec} (exit ${exitCode}).`,
        }),
      });
    }

    yield* Effect.logDebug("ssh.command.succeeded").pipe(
      Effect.annotateLogs({
        ...sshTargetLogFields(target),
        command: ["ssh", ...args],
      }),
    );
    return { stdout, stderr };
  });

export const runSshCommand = (
  target: SshTarget,
  input: RunSshCommandOptions = {},
): Effect.Effect<
  SshCommandResult,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.scopedWith((commandScope) => runSshCommandInScope(target, input, commandScope)).pipe(
    Effect.timeoutOption(Duration.millis(input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS)),
    Effect.flatMap((result) =>
      Option.match(result, {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.gen(function* () {
            yield* Effect.logWarning("ssh.command.timedOut").pipe(
              Effect.annotateLogs({
                ...sshTargetLogFields(target),
                timeoutMs: input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS,
              }),
            );
            return yield* new SshCommandError({
              command: ["ssh"],
              exitCode: null,
              stderr: "",
              message: `SSH command timed out after ${input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS}ms.`,
            });
          }),
      }),
    ),
  );

export const resolveSshTarget = (
  alias: string,
): Effect.Effect<
  SshTarget,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const trimmedAlias = alias.trim();
    if (trimmedAlias.length === 0) {
      return yield* new SshInvalidTargetError({ message: "SSH host alias is required." });
    }

    yield* Effect.logDebug("ssh.target.resolve.start").pipe(
      Effect.annotateLogs({ alias: trimmedAlias }),
    );
    return yield* runSshCommand(
      {
        alias: trimmedAlias,
        hostname: trimmedAlias,
        username: null,
        port: null,
      },
      { preHostArgs: ["-G"] },
    ).pipe(
      Effect.map((result) => parseSshResolveOutput(trimmedAlias, result.stdout)),
      Effect.tap((target) =>
        Effect.logDebug("ssh.target.resolve.succeeded").pipe(
          Effect.annotateLogs(sshTargetLogFields(target)),
        ),
      ),
      Effect.catch(() =>
        Effect.logDebug("ssh.target.resolve.fallback").pipe(
          Effect.annotateLogs({ alias: trimmedAlias }),
          Effect.as({
            alias: trimmedAlias,
            hostname: trimmedAlias,
            username: null,
            port: null,
          } satisfies SshTarget),
        ),
      ),
    );
  });

export const resolveSshInput = (
  raw: string,
): Effect.Effect<
  SshTarget,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const parsed = parseSshInput(raw);
    if (parsed.alias.length === 0) {
      return yield* new SshInvalidTargetError({ message: "SSH host is required." });
    }
    const resolved = yield* resolveSshTarget(parsed.alias);
    return overlaySshTarget(resolved, parsed);
  });

export { getLastNonEmptyOutputLine };
