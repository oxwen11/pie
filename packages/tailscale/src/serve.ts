import { Effect, FileSystem } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { runTailscaleCommand, TAILSCALE_SERVE_TIMEOUT_MS } from "./command";
import type { TailscaleClientMissingError, TailscaleCommandError } from "./errors";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;

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

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleCommandError | TailscaleClientMissingError, TailscaleCli> =>
  runTailscaleCommand(tailscaleServeEnableArgs(input), TAILSCALE_SERVE_TIMEOUT_MS).pipe(
    Effect.asVoid,
  );

export const disableTailscaleServe = (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.Effect<void, TailscaleCommandError | TailscaleClientMissingError, TailscaleCli> =>
  runTailscaleCommand(tailscaleServeDisableArgs(input), TAILSCALE_SERVE_TIMEOUT_MS).pipe(
    Effect.asVoid,
    Effect.catchTag("TailscaleCommandError", (error) =>
      error.stderrDiagnostic === "no-existing-handler" ? Effect.void : Effect.fail(error),
    ),
  );
