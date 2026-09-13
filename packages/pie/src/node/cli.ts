#!/usr/bin/env node

import "zod/compile";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveDaemonDirectory, statusDaemon, stopDaemon } from "@getpie/server/daemon";
import { daemonServeEnvironment, resolveServeConfig, serve, serveFlags } from "@getpie/server/http";
import { attachRelay, relayPublicBaseUrl } from "@getpie/server/relay";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import pkg from "../../package.json" with { type: "json" };
import { resolveCliDaemon } from "./daemon";
import { parseHostPort, relayListenFlags, runRelayListen, takeRelayToken } from "./relay-cli";
import { runCommand } from "./session-cli";

type DaemonStartInput = {
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly corsOrigin: ReadonlyArray<string>;
  readonly allowedHost: ReadonlyArray<string>;
};

// Default startup is the daemon: a short-lived `pie` command must operate a
// backend that outlives it, so it attaches to the running daemon or spawns one.
// `$PIE_HOME` comes from the ambient environment through the shared resolver,
// which is also what `stop`/`status` and a desktop app inheriting the same
// home use — that is what makes them address one daemon.
const startDaemon = (input: DaemonStartInput) =>
  Effect.gen(function* () {
    // Same flag > env > default port precedence as `pie serve`. CORS is not
    // resolved here: the daemon's policy is static, and any extra origins are
    // inherited from the ambient PIE_CORS_ORIGINS by the spawned daemon.
    const config = yield* resolveServeConfig(input);
    const handle = yield* resolveCliDaemon(
      config.port,
      daemonServeEnvironment(process.env, config),
    );
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
      console.log("Start it with: pie daemon start");
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

const daemon = Command.make("daemon", serveFlags, startDaemon).pipe(
  Command.withDescription("Manage the pie daemon (bare `daemon` starts it)"),
  Command.withSubcommands([daemonStart, daemonStop, daemonStatus]),
);

const mintPairing = () =>
  Effect.gen(function* () {
    const status = yield* statusDaemon(resolveDaemonDirectory());
    if (!status.running) {
      return yield* Effect.fail(new Error("pie daemon is not running"));
    }
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(new URL("/api/pairing/mint", status.record.address), {
          method: "POST",
          headers: { authorization: `Bearer ${status.record.token}` },
        }),
      catch: (cause) => new Error(`pairing mint failed: ${String(cause)}`),
    });
    if (!response.ok) {
      return yield* Effect.fail(new Error(`pairing mint failed (${String(response.status)})`));
    }
    const body: unknown = yield* Effect.tryPromise(() => response.json());
    if (
      typeof body !== "object" ||
      body === null ||
      !("code" in body) ||
      typeof body.code !== "string"
    ) {
      return yield* Effect.fail(new Error("pairing mint returned no code"));
    }
    console.log(body.code);
    if ("expiresAt" in body && typeof body.expiresAt === "number") {
      console.log(`expires ${new Date(body.expiresAt).toISOString()}`);
    }
    return yield* Effect.void;
  });

const pairingMint = Command.make("mint", {}, mintPairing).pipe(
  Command.withDescription("Mint a one-time pairing code against the running daemon"),
);
const pairing = Command.make("pairing", {}, mintPairing).pipe(
  Command.withDescription("Pair a browser to this daemon without sharing the daemon token"),
  Command.withSubcommands([pairingMint]),
);

const relayListen = Command.make("listen", relayListenFlags, runRelayListen).pipe(
  Command.withDescription("Accept daemon attach and public clients on a public hop"),
);

const relayAttachFlags = {
  to: Flag.string("to").pipe(
    Flag.withDescription("Public relay host:port (e.g. 96.44.165.19:8443)"),
  ),
  control: Flag.string("control").pipe(
    Flag.withDescription("Control host:port printed by pie relay listen"),
  ),
  local: Flag.string("local").pipe(
    Flag.withDescription("Foreground pie serve host:port instead of the running daemon"),
    Flag.optional,
  ),
};

const relayAttach = Command.make("attach", relayAttachFlags, (input) =>
  Effect.gen(function* () {
    const token = takeRelayToken();
    const hop = parseHostPort(input.to);
    relayPublicBaseUrl({ host: hop.host, port: hop.port });
    const control = parseHostPort(input.control);
    const localFlag = Option.getOrUndefined(input.local);
    let localHost: string;
    let localPort: number;
    if (localFlag !== undefined) {
      const parsed = parseHostPort(localFlag);
      localHost = parsed.host;
      localPort = parsed.port;
    } else {
      const status = yield* statusDaemon(resolveDaemonDirectory());
      if (!status.running) {
        return yield* Effect.fail(new Error("pie daemon is not running"));
      }
      const local = new URL(status.record.address);
      localHost = local.hostname;
      localPort = Number(local.port);
    }
    const allowed = (process.env.PIE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (!allowed.includes(hop.host.toLowerCase())) {
      return yield* Effect.fail(
        new Error(
          `relay public Host ${hop.host} is not in PIE_ALLOWED_HOSTS. Restart the daemon with --allowed-host ${hop.host}`,
        ),
      );
    }
    const handle = yield* Effect.tryPromise(() =>
      attachRelay({
        relayHost: control.host,
        relayPort: control.port,
        token,
        localHost,
        localPort,
      }),
    );
    console.log(`pie relay attached to ${input.to} via ${input.control}`);
    yield* Effect.addFinalizer(() => Effect.promise(() => handle.close()));
    return yield* Effect.never;
  }),
).pipe(Command.withDescription("Connect this daemon out to a public relay hop"));

const relay = Command.make("relay", {}, () =>
  Effect.sync(() => {
    console.error(
      "usage: pie relay listen | pie relay attach --to host:port --control host:port [--local host:port]",
    );
  }),
).pipe(
  Command.withDescription("Public reverse-tunnel hop for daemons without inbound ports"),
  Command.withSubcommands([relayListen, relayAttach]),
);

// `pie serve` stays the plain foreground server — the launcher spawns it
// detached, and process managers / containers / the SSH runner use it directly.
// Bare `pie` defaults to daemon startup.
const pie = Command.make("pie", serveFlags, startDaemon).pipe(
  Command.withDescription("Pie local server"),
  Command.withSubcommands([serve, daemon, pairing, relay, runCommand]),
);

Command.run(pie, { version: pkg.version }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
);
