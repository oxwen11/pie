import net from "node:net";

import { Deferred, Duration, Effect, Exit, FileSystem, Schedule, Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  baseSshArgs,
  collectProcessOutput,
  isSshAuthFailure,
  isSshSpawnNotFound,
  redactSshErrorOutput,
  requireSshCommand,
  runSshCommand,
  sshClientMissingMessage,
  sshSpawnEnv,
} from "./command";
import {
  SshClientMissingError,
  SshCommandError,
  SshInvalidTargetError,
  SshLaunchError,
  SshReadinessError,
} from "./errors";
import {
  buildRemoteLaunchScript,
  resolveRemotePiePackageSpec,
  type RemotePieRunnerOptions,
  REMOTE_LAUNCH_TIMEOUT_MS,
  SSH_READY_PROBE_TIMEOUT_MS,
  SSH_READY_TIMEOUT_MS,
  TUNNEL_SHUTDOWN_TIMEOUT_MS,
} from "./scripts";
import {
  buildSshHostSpecEffect,
  parseRemoteLaunchOutput,
  remoteStateKey,
  type RemoteLaunchResult,
  type SshEnvironmentBootstrap,
  type SshTarget,
} from "./target";

export const LOCAL_FORWARD_HOST = "127.0.0.1";
export const REMOTE_FORWARD_HOST = "127.0.0.1";

const READY_POLL_INTERVAL_MS = 200;
const SSH_AUTH_FAILURE_MESSAGE =
  "SSH authentication failed. Use ssh-agent or an IdentityFile in ~/.ssh/config (password prompts are not wired in pie v1).";

export type SshForwardedConnection = {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly token: string;
};

export type SshTunnel = {
  readonly localPort: number;
  readonly remotePort: number;
  readonly close: Effect.Effect<void>;
  /** Completes when the `ssh -N` child exits, including after `close`. */
  readonly closed: Effect.Effect<void>;
  readonly alive: Effect.Effect<boolean>;
  /** Drained `ssh -N` stderr; completes when the child closes the stream. */
  readonly stderr: Effect.Effect<string>;
};

export type SshConnectedEnvironment = SshEnvironmentBootstrap & {
  readonly close: Effect.Effect<void>;
  readonly closed: Effect.Effect<void>;
  readonly alive: Effect.Effect<boolean>;
};

export type SshCliEnv = {
  readonly env?: NodeJS.ProcessEnv;
};

export function forwardedConnection(localPort: number, token: string): SshForwardedConnection {
  return {
    httpBaseUrl: `http://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
    wsBaseUrl: `ws://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
    token,
  };
}

export const reserveLoopbackPort = (): Effect.Effect<number, SshLaunchError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", (cause) => {
          server.close();
          reject(cause);
        });
        server.listen(0, LOCAL_FORWARD_HOST, () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            server.close();
            reject(new Error("Failed to reserve a loopback port for SSH forwarding."));
            return;
          }
          const port = address.port;
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(port);
          });
        });
      }),
    catch: (cause) =>
      new SshLaunchError({
        message: "Failed to reserve a loopback port for SSH forwarding.",
        stdout: "",
        cause,
      }),
  });

export const waitForHttpReady = (input: {
  readonly address: string;
  readonly timeoutMs?: number;
  readonly probeTimeoutMs?: number;
}): Effect.Effect<void, SshReadinessError> =>
  Effect.gen(function* () {
    const timeoutMs = input.timeoutMs ?? SSH_READY_TIMEOUT_MS;
    const probeTimeoutMs = input.probeTimeoutMs ?? SSH_READY_PROBE_TIMEOUT_MS;
    let lastError: unknown;

    const probe = Effect.promise(async () => {
      try {
        const response = await fetch(new URL("/api/health", input.address), {
          signal: AbortSignal.timeout(probeTimeoutMs),
        });
        return response.ok && (await response.text()) === "ok";
      } catch (cause) {
        lastError = cause;
        return false;
      }
    });

    const healthy = yield* probe.pipe(
      Effect.repeat({
        until: (ready) => ready,
        schedule: Schedule.spaced(Duration.millis(READY_POLL_INTERVAL_MS)).pipe(
          Schedule.upTo({ duration: Duration.millis(timeoutMs) }),
        ),
      }),
    );

    if (healthy) return;

    return yield* new SshReadinessError({
      message: `Remote pie daemon did not become ready at ${input.address} within ${String(timeoutMs)}ms.`,
      cause: lastError,
    });
  });

function launchErrorFromDiagnostic(
  diagnostic: string,
  fallback: string,
  cause?: unknown,
): SshLaunchError {
  const message = isSshAuthFailure(diagnostic)
    ? SSH_AUTH_FAILURE_MESSAGE
    : diagnostic.length > 0
      ? diagnostic
      : fallback;
  if (cause === undefined) {
    return new SshLaunchError({ message, stdout: diagnostic });
  }
  return new SshLaunchError({ message, stdout: diagnostic, cause });
}

function toLaunchError(
  error: SshCommandError | SshClientMissingError | SshInvalidTargetError,
): SshLaunchError | SshClientMissingError | SshInvalidTargetError {
  if (error instanceof SshInvalidTargetError || error instanceof SshClientMissingError) {
    return error;
  }

  const stdout = redactSshErrorOutput(error.stdout ?? "");
  const stderr = redactSshErrorOutput(error.stderr);
  const diagnostic = stderr || stdout;
  if (isSshAuthFailure(error) || isSshAuthFailure(diagnostic)) {
    return new SshLaunchError({
      message: SSH_AUTH_FAILURE_MESSAGE,
      stdout: diagnostic,
      cause: error,
    });
  }
  return new SshLaunchError({
    message: diagnostic.length > 0 ? diagnostic : error.message,
    stdout,
    cause: error,
  });
}

export const launchOrReuseRemoteServer = (
  target: SshTarget,
  options?: RemotePieRunnerOptions & SshCliEnv,
): Effect.Effect<
  RemoteLaunchResult,
  SshLaunchError | SshClientMissingError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    yield* Effect.logDebug("ssh.remote.launch.start").pipe(
      Effect.annotateLogs({
        alias: target.alias,
        hostname: target.hostname,
        stateKey: remoteStateKey(target),
      }),
    );
    const result = yield* runSshCommand(target, {
      stdin: buildRemoteLaunchScript({
        ...options,
        packageSpec: resolveRemotePiePackageSpec(options?.packageSpec),
      }),
      remoteCommandArgs: ["sh", "-l", "-s", remoteStateKey(target)],
      timeoutMs: REMOTE_LAUNCH_TIMEOUT_MS,
      env: options?.env,
    }).pipe(Effect.mapError(toLaunchError));

    const parsed = parseRemoteLaunchOutput(result.stdout);
    if (parsed === undefined) {
      return yield* new SshLaunchError({
        message: "Remote pie daemon did not report a launch payload.",
        stdout: redactSshErrorOutput(result.stderr || result.stdout),
      });
    }
    return parsed;
  });

export const startSshTunnel = (
  target: SshTarget,
  remotePort: number,
  options?: SshCliEnv,
): Effect.Effect<
  SshTunnel,
  SshLaunchError | SshClientMissingError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const hostSpec = yield* buildSshHostSpecEffect(target);
    const sshCommand = yield* requireSshCommand({ env: options?.env });
    const localPort = yield* reserveLoopbackPort();
    const tunnelScope = yield* Scope.make();
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = sshSpawnEnv(options?.env);
    const args = [
      ...baseSshArgs(target),
      "-N",
      "-L",
      `${String(localPort)}:${REMOTE_FORWARD_HOST}:${String(remotePort)}`,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      hostSpec,
    ];

    yield* Effect.logDebug("ssh.tunnel.start").pipe(
      Effect.annotateLogs({
        alias: target.alias,
        hostname: target.hostname,
        localPort,
        remotePort,
      }),
    );

    const child = yield* spawner
      .spawn(
        ChildProcess.make(sshCommand, args, {
          env: environment,
          extendEnv: false,
          forceKillAfter: Duration.millis(TUNNEL_SHUTDOWN_TIMEOUT_MS),
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, tunnelScope),
        Effect.mapError((cause) =>
          isSshSpawnNotFound(cause)
            ? new SshClientMissingError({
                command: sshCommand,
                message: sshClientMissingMessage(sshCommand),
              })
            : new SshLaunchError({
                message:
                  cause instanceof Error
                    ? cause.message
                    : `Failed to spawn SSH tunnel for ${hostSpec}.`,
                stdout: "",
                cause,
              }),
        ),
      );

    const stderrDone = yield* Deferred.make<string>();
    yield* collectProcessOutput(child.stderr).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((output) => Deferred.succeed(stderrDone, output)),
      Effect.ensuring(Deferred.succeed(stderrDone, "")),
      Effect.forkIn(tunnelScope),
    );

    const close = Effect.ignore(Scope.close(tunnelScope, Exit.void)).pipe(Effect.asVoid);
    const closed = child.exitCode.pipe(Effect.asVoid, Effect.ignore);
    const alive = child.isRunning.pipe(Effect.orElseSucceed(() => false));
    return {
      localPort,
      remotePort,
      close,
      closed,
      alive,
      stderr: Deferred.await(stderrDone),
    };
  });

export const waitForForwardedDaemon = (localPort: number): Effect.Effect<void, SshReadinessError> =>
  waitForHttpReady({
    address: `http://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
  });

export const connectSshEnvironment = (
  target: SshTarget,
  options?: RemotePieRunnerOptions & SshCliEnv,
): Effect.Effect<
  SshConnectedEnvironment,
  SshLaunchError | SshClientMissingError | SshInvalidTargetError | SshReadinessError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const launch = yield* launchOrReuseRemoteServer(target, options);
    const tunnel = yield* startSshTunnel(target, launch.remotePort, { env: options?.env });
    const tunnelExited = tunnel.closed.pipe(
      Effect.andThen(tunnel.stderr),
      Effect.flatMap((output) =>
        Effect.fail(
          launchErrorFromDiagnostic(
            redactSshErrorOutput(output),
            `SSH tunnel to ${target.hostname} exited before the local forward was ready.`,
          ),
        ),
      ),
    );
    yield* Effect.raceFirst(waitForForwardedDaemon(tunnel.localPort), tunnelExited).pipe(
      Effect.tapError(() => tunnel.close),
    );
    return {
      target,
      httpBaseUrl: forwardedConnection(tunnel.localPort, launch.token).httpBaseUrl,
      wsBaseUrl: forwardedConnection(tunnel.localPort, launch.token).wsBaseUrl,
      token: launch.token,
      remotePort: launch.remotePort,
      close: tunnel.close,
      closed: tunnel.closed,
      alive: tunnel.alive,
    };
  });
