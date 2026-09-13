import { Effect, FileSystem } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  runTailscaleCommand,
  TAILSCALE_SERVE_TIMEOUT_MS,
  type FindTailscaleCommandOptions,
} from "./command";
import { TailscaleCommandError, type TailscaleClientMissingError } from "./errors";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;

export type TailscaleServeOwnership = "empty" | "ours" | "foreign";

function proxyTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const nested: string[] = [];
  const proxy = record["Proxy"];
  if (typeof proxy === "string") nested.push(proxy);
  for (const child of Object.values(record)) {
    nested.push(...proxyTargets(child));
  }
  return nested;
}

/** Who currently owns HTTPS Serve, based on `tailscale serve status --json`. */
export function decodeTailscaleServeOwnership(
  raw: string,
  localPort: number,
): TailscaleServeOwnership {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim().length === 0 ? "empty" : "foreign";
  }
  const proxies = proxyTargets(parsed);
  if (proxies.length === 0) return "empty";
  const ours = `:${String(localPort)}`;
  const matches = proxies.filter((proxy) => proxy.includes(ours));
  if (matches.length === proxies.length) return "ours";
  if (matches.length === 0) return "foreign";
  return "foreign";
}

type TailscaleCli = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem;

export function tailscaleServeEnableArgs(input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): string[] {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  return ["serve", "--bg", `--https=${servePort}`, `http://${localHost}:${input.localPort}`];
}

export function tailscaleServeDisableArgs(input: { readonly servePort?: number } = {}): string[] {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  return ["serve", `--https=${servePort}`, "off"];
}

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

export const readTailscaleServeOwnership = (input: {
  readonly localPort: number;
  readonly env?: NodeJS.ProcessEnv;
}): Effect.Effect<
  TailscaleServeOwnership,
  TailscaleCommandError | TailscaleClientMissingError,
  TailscaleCli
> =>
  runTailscaleCommand(["serve", "status", "--json"], TAILSCALE_SERVE_TIMEOUT_MS, {
    env: input.env,
  }).pipe(
    Effect.map((result) => decodeTailscaleServeOwnership(result.stdout, input.localPort)),
    Effect.catchTag("TailscaleCommandError", (error) =>
      error.stderrDiagnostic === "no-existing-handler"
        ? Effect.succeed("empty" as const)
        : Effect.fail(error),
    ),
  );

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Effect.Effect<void, TailscaleCommandError | TailscaleClientMissingError, TailscaleCli> =>
  Effect.gen(function* () {
    const ownership = yield* readTailscaleServeOwnership({
      localPort: input.localPort,
      env: input.env,
    });
    if (ownership === "ours") return;
    if (ownership === "foreign") {
      return yield* new TailscaleCommandError({
        message: "Tailscale Serve HTTPS is already in use by another handler",
        command: tailscaleServeEnableArgs(input),
        exitCode: 1,
      });
    }
    yield* runTailscaleCommand(tailscaleServeEnableArgs(input), TAILSCALE_SERVE_TIMEOUT_MS, {
      env: input.env,
    });
  });

export const disableTailscaleServe = (
  input: {
    readonly servePort?: number;
    readonly localPort?: number;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Effect.Effect<void, TailscaleCommandError | TailscaleClientMissingError, TailscaleCli> =>
  Effect.gen(function* () {
    if (input.localPort !== undefined) {
      const ownership = yield* readTailscaleServeOwnership({
        localPort: input.localPort,
        env: input.env,
      });
      if (ownership !== "ours") return;
    }
    yield* runTailscaleCommand(tailscaleServeDisableArgs(input), TAILSCALE_SERVE_TIMEOUT_MS, {
      env: input.env,
    } satisfies FindTailscaleCommandOptions).pipe(
      Effect.asVoid,
      Effect.catchTag("TailscaleCommandError", (error) =>
        error.stderrDiagnostic === "no-existing-handler" ? Effect.void : Effect.fail(error),
      ),
    );
  });
