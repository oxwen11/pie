import net from "node:net";

import { Duration, Effect, Exit, FileSystem, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { buildSshChildEnvironment, isSshAuthFailure } from "./auth";
import {
  baseSshArgs,
  redactSshErrorOutput,
  runSshCommand,
  sshCommandForPlatform,
  sshSpawnEnv,
} from "./command";
import {
  SshCommandError,
  SshInvalidTargetError,
  SshLaunchError,
  SshReadinessError,
} from "./errors";
import {
  buildRemoteLaunchScript,
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

const TUNNEL_START_GRACE_MS = 500;
const READY_POLL_INTERVAL_MS = 200;

export type SshForwardedConnection = {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly token: string;
};

export type SshTunnel = {
  readonly localPort: number;
  readonly remotePort: number;
  readonly close: Effect.Effect<void>;
};

export type SshConnectedEnvironment = SshEnvironmentBootstrap & {
  readonly close: Effect.Effect<void>;
};

export function forwardedConnection(localPort: number, token: string): SshForwardedConnection {
  return {
    httpBaseUrl: `http://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
    wsBaseUrl: `ws://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
    token,
  };
}

const collectProcessOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

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
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      const healthy = yield* Effect.promise(async () => {
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
      if (healthy) return;
      yield* Effect.sleep(READY_POLL_INTERVAL_MS);
    }

    return yield* new SshReadinessError({
      message: `Remote pie daemon did not become ready at ${input.address} within ${String(timeoutMs)}ms.`,
      cause: lastError,
    });
  });

function toLaunchError(
  error: SshCommandError | SshInvalidTargetError,
): SshLaunchError | SshInvalidTargetError {
  if (error instanceof SshInvalidTargetError) return error;

  const stdout = redactSshErrorOutput(error.stdout ?? "");
  const stderr = redactSshErrorOutput(error.stderr);
  const diagnostic = stderr || stdout;
  if (isSshAuthFailure(error) || isSshAuthFailure(diagnostic)) {
    return new SshLaunchError({
      message:
        "SSH authentication failed. Use ssh-agent or an IdentityFile in ~/.ssh/config (password prompts are not wired in pie v1).",
      stdout,
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
): Effect.Effect<
  RemoteLaunchResult,
  SshLaunchError | SshInvalidTargetError,
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
      stdin: buildRemoteLaunchScript(),
      remoteCommandArgs: ["sh", "-l", "-s", remoteStateKey(target)],
      timeoutMs: REMOTE_LAUNCH_TIMEOUT_MS,
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
): Effect.Effect<
  SshTunnel,
  SshLaunchError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const hostSpec = yield* buildSshHostSpecEffect(target);
    const localPort = yield* reserveLoopbackPort();
    const tunnelScope = yield* Scope.make();
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sshCommand = sshCommandForPlatform();
    const environment = yield* buildSshChildEnvironment({
      baseEnv: sshSpawnEnv(),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new SshLaunchError({
            message: "Failed to prepare SSH authentication helpers.",
            stdout: "",
            cause,
          }),
      ),
    );
    const args = [
      ...baseSshArgs(target, { batchMode: "yes" }),
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
        Effect.mapError(
          (cause) =>
            new SshLaunchError({
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to spawn SSH tunnel for ${hostSpec}.`,
              stdout: "",
              cause,
            }),
        ),
      );

    yield* Effect.sleep(TUNNEL_START_GRACE_MS);
    const running = yield* child.isRunning.pipe(Effect.orElseSucceed(() => false));
    if (!running) {
      const output = yield* collectProcessOutput(child.stderr).pipe(Effect.orElseSucceed(() => ""));
      yield* Effect.ignore(Scope.close(tunnelScope, Exit.void));
      const diagnostic = redactSshErrorOutput(output);
      if (isSshAuthFailure(diagnostic)) {
        return yield* new SshLaunchError({
          message:
            "SSH authentication failed. Use ssh-agent or an IdentityFile in ~/.ssh/config (password prompts are not wired in pie v1).",
          stdout: diagnostic,
        });
      }
      return yield* new SshLaunchError({
        message:
          diagnostic.length > 0
            ? diagnostic
            : `SSH tunnel to ${hostSpec} exited before the local forward was ready.`,
        stdout: diagnostic,
      });
    }

    const close = Effect.ignore(Scope.close(tunnelScope, Exit.void)).pipe(Effect.asVoid);
    return { localPort, remotePort, close };
  });

export const waitForForwardedDaemon = (localPort: number): Effect.Effect<void, SshReadinessError> =>
  waitForHttpReady({
    address: `http://${LOCAL_FORWARD_HOST}:${String(localPort)}`,
  });

export const connectSshEnvironment = (
  target: SshTarget,
): Effect.Effect<
  SshConnectedEnvironment,
  SshLaunchError | SshInvalidTargetError | SshReadinessError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const launch = yield* launchOrReuseRemoteServer(target);
    const tunnel = yield* startSshTunnel(target, launch.remotePort);
    yield* waitForForwardedDaemon(tunnel.localPort).pipe(Effect.tapError(() => tunnel.close));
    return {
      target,
      httpBaseUrl: forwardedConnection(tunnel.localPort, launch.token).httpBaseUrl,
      wsBaseUrl: forwardedConnection(tunnel.localPort, launch.token).wsBaseUrl,
      token: launch.token,
      remotePort: launch.remotePort,
      remoteServerKind: launch.serverKind,
      close: tunnel.close,
    };
  });
