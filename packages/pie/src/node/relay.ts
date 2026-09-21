#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import pkg from "../../package.json" with { type: "json" };
import { relayListenFlags, runRelayListen } from "./relay-cli";

const pieRelay = Command.make("pie-relay", relayListenFlags, runRelayListen).pipe(
  Command.withDescription("Public reverse-tunnel hop; deploy this without a pie daemon"),
);

Command.run(pieRelay, { version: pkg.version }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
);
