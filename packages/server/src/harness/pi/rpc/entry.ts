#!/usr/bin/env bun
// Match Pi's Bun CLI ordering, but start Pie's RPC loop instead of the CLI/TUI.
// Keep recovery before runtime setup: imported modules may read process.env.
import "@earendil-works/pi-coding-agent/bun/sandbox-env-setup";
import "@earendil-works/pi-coding-agent/bun/runtime-setup";
import { main } from "./main";
import { RpcChildExitError } from "./rpc-mode";

void main().catch((cause: unknown) => {
  if (cause instanceof RpcChildExitError) {
    process.exitCode = cause.exitCode;
    return;
  }
  console.error(cause);
  process.exitCode = 1;
});
