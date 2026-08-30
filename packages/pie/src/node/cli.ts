#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { embeddedDaemonCompatibilityKey } from "@getpie/core/compatibility";
import {
  resolveDaemonDirectory,
  resolveDaemonLocation,
  resolveOrSpawnDaemon,
  statusDaemon,
  stopDaemon,
} from "@getpie/server/daemon";
import { resolveServeConfig, serve, serveFlags } from "@getpie/server/http";
import { Effect, Option, Result } from "effect";
import { Command } from "effect/unstable/cli";

import pkg from "../../package.json" with { type: "json" };
import { openSystemUrl } from "./open-url";
import { pairResidentDaemon } from "./pairing";

/**
 * argv that re-launches this very CLI in foreground `serve` mode. The daemon is
 * just `pie serve` spawned detached — no second bundle, and `execArgv`
 * carries the dev loader (e.g. tsx) so it works from source too.
 */
function serverArgv(): string[] {
  return [process.execPath, ...process.execArgv, process.argv[1] ?? "", "serve"];
}

type DaemonStartInput = {
  readonly port: Option.Option<number>;
  readonly corsOrigin: ReadonlyArray<string>;
  readonly allowedHost: ReadonlyArray<string>;
};

const resolveDaemon = (input: DaemonStartInput) => {
  const { port } = resolveServeConfig(input);
  return resolveOrSpawnDaemon({
    ...resolveDaemonLocation(),
    requiredCompatibilityKey: embeddedDaemonCompatibilityKey(),
    serverArgv: serverArgv(),
    port,
  });
};

const browserPairing = (input: DaemonStartInput) => pairResidentDaemon(resolveDaemon(input));

// Default startup is the daemon: a short-lived `pie` command must operate a
// backend that outlives it, so it attaches to the running daemon or spawns one.
const startDaemon = (input: DaemonStartInput) =>
  Effect.gen(function* () {
    const handle = yield* resolveDaemon(input);
    console.log(
      handle.reused
        ? `pie daemon already running at ${handle.address} (pid ${handle.pid})`
        : `pie daemon started at ${handle.address} (pid ${handle.pid})`,
    );
    const explicitPort = Option.getOrUndefined(input.port);
    if (handle.reused && explicitPort !== undefined && handle.port !== explicitPort) {
      console.log(
        `note: --port ${explicitPort} ignored — attached to the daemon already running on port ${handle.port}`,
      );
    }
  });

const pairHandler = (input: DaemonStartInput) =>
  Effect.gen(function* () {
    const { pairing } = yield* browserPairing(input);
    console.log(pairing.url);
    console.log(`This one-time pairing link expires in ${pairing.expiresInSeconds} seconds.`);
  });

const openHandler = (input: DaemonStartInput) =>
  Effect.gen(function* () {
    const { handle, pairing } = yield* browserPairing(input);
    const opened = yield* openSystemUrl(pairing.url).pipe(Effect.result);
    if (Result.isSuccess(opened)) {
      console.log(`Opened Pie in the browser at ${handle.address}`);
      return;
    }
    console.error("Unable to launch the system browser. Open this one-time pairing link manually:");
    console.log(pairing.url);
  });

const stopHandler = () =>
  Effect.gen(function* () {
    const result = yield* stopDaemon(resolveDaemonDirectory());
    console.log(result === "stopped" ? "pie daemon stopped" : "pie daemon is not running");
  });

const statusHandler = () =>
  Effect.gen(function* () {
    const status = yield* statusDaemon(resolveDaemonDirectory());
    if (!status.running) {
      console.log("pie daemon is not running");
      return;
    }
    console.log(`pie daemon running at ${status.record.address} (pid ${status.record.pid})`);
  });

const daemonStart = Command.make("start", serveFlags, startDaemon).pipe(
  Command.withDescription("Start the pie daemon, or attach if one is already running"),
);
const daemonStop = Command.make("stop", {}, stopHandler).pipe(
  Command.withDescription("Stop the running pie daemon"),
);
const daemonStatus = Command.make("status", {}, statusHandler).pipe(
  Command.withDescription("Report whether the pie daemon is running"),
);

const pair = Command.make("pair", serveFlags, pairHandler).pipe(
  Command.withDescription("Print a one-time browser pairing link"),
);
const open = Command.make("open", serveFlags, openHandler).pipe(
  Command.withDescription("Open Pie in the system browser"),
);

const daemon = Command.make("daemon", serveFlags, startDaemon).pipe(
  Command.withDescription("Manage the pie daemon (bare `daemon` starts it)"),
  Command.withSubcommands([daemonStart, daemonStop, daemonStatus]),
);

// `pie serve` stays the plain foreground server — the launcher spawns it
// detached, and process managers / containers / the SSH runner use it directly.
// Bare `pie` defaults to daemon startup.
const pie = Command.make("pie", serveFlags, startDaemon).pipe(
  Command.withDescription("Pie local server"),
  Command.withSubcommands([serve, daemon, pair, open]),
);

Command.run(pie, { version: pkg.version }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
);
