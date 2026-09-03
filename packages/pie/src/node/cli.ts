#!/usr/bin/env node

import "zod/compile";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveDaemonDirectory, statusDaemon, stopDaemon } from "@getpie/server/daemon";
import { resolveServeConfig, serve, serveFlags } from "@getpie/server/http";
import { Console, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";

import pkg from "../../package.json" with { type: "json" };
import { resolveCliDaemon } from "./daemon";
import { runCommand } from "./session-cli";

type DaemonStartInput = {
  readonly port: Option.Option<number>;
  readonly corsOrigin: ReadonlyArray<string>;
  readonly allowedHost: ReadonlyArray<string>;
};

// Default startup is the daemon: a short-lived `pie` command must operate a
// backend that outlives it, so it attaches to the running daemon or spawns one.
// Both directories come from the ambient environment through the shared
// resolver, which is also what `stop`/`status` and a desktop app inheriting the
// same `PIE_DAEMON_DIR` use — that is what makes them address one daemon.
const startDaemon = (input: DaemonStartInput) =>
  Effect.gen(function* () {
    // Same flag > env > default port precedence as `pie serve`. CORS is not
    // resolved here: the daemon's policy is static, and any extra origins are
    // inherited from the ambient PIE_CORS_ORIGINS by the spawned daemon.
    const { port } = yield* resolveServeConfig(input);
    const handle = yield* resolveCliDaemon(port);
    yield* Console.log(
      handle.reused
        ? `pie daemon already running at ${handle.address} (pid ${handle.pid})`
        : `pie daemon started at ${handle.address} (pid ${handle.pid})`,
    );
    const explicitPort = Option.getOrUndefined(input.port);
    if (handle.reused && explicitPort !== undefined && handle.port !== explicitPort) {
      yield* Console.log(
        `note: --port ${explicitPort} ignored — attached to the daemon already running on port ${handle.port}`,
      );
    }
  });

const stopHandler = () =>
  Effect.gen(function* () {
    const result = yield* stopDaemon(resolveDaemonDirectory());
    yield* Console.log(result === "stopped" ? "pie daemon stopped" : "pie daemon is not running");
  });

const statusHandler = () =>
  Effect.gen(function* () {
    const status = yield* statusDaemon(resolveDaemonDirectory());
    if (!status.running) {
      yield* Console.log("pie daemon is not running");
      yield* Console.log("Start it with: pie daemon start");
      return;
    }
    yield* Console.log(`pie daemon running at ${status.record.address} (pid ${status.record.pid})`);
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

const daemon = Command.make("daemon", serveFlags, startDaemon).pipe(
  Command.withDescription("Manage the pie daemon (bare `daemon` starts it)"),
  Command.withSubcommands([daemonStart, daemonStop, daemonStatus]),
);

// `pie serve` stays the plain foreground server — the launcher spawns it
// detached, and process managers / containers / the SSH runner use it directly.
// Bare `pie` defaults to daemon startup.
const pie = Command.make("pie", serveFlags, startDaemon).pipe(
  Command.withDescription("Pie local server"),
  Command.withSubcommands([serve, daemon, runCommand]),
);

Command.run(pie, { version: pkg.version }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
);
