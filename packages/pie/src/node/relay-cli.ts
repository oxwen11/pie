import { listenRelay, relayPublicBaseUrl } from "@getpie/server/relay";
import { Effect } from "effect";
import { Flag } from "effect/unstable/cli";

export function takeRelayToken(): string {
  const token = process.env.PIE_RELAY_TOKEN;
  delete process.env.PIE_RELAY_TOKEN;
  if (token === undefined || token.trim().length === 0) {
    throw new Error("PIE_RELAY_TOKEN is required");
  }
  return token;
}

type HostPort = {
  readonly host: string;
  readonly port: number;
};

export function parseHostPort(value: string): HostPort {
  const trimmed = value.trim();
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0 || idx === trimmed.length - 1) {
    throw new Error(`expected host:port, got ${trimmed}`);
  }
  const host = trimmed.slice(0, idx);
  const port = Number.parseInt(trimmed.slice(idx + 1), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`expected host:port, got ${trimmed}`);
  }
  return { host, port };
}

export const relayListenFlags = {
  port: Flag.integer("port").pipe(Flag.withDescription("Public port to listen on")),
  publicHost: Flag.string("public-host").pipe(
    Flag.withDescription("Public hop clients must use (not Tailscale, LAN, or loopback)"),
  ),
};

export const runRelayListen = (input: { readonly port: number; readonly publicHost: string }) =>
  Effect.gen(function* () {
    relayPublicBaseUrl({ host: input.publicHost, port: input.port });
    const token = takeRelayToken();
    const handle = yield* Effect.tryPromise(() =>
      listenRelay({
        port: input.port,
        controlPort: input.port + 1,
        token,
        publicHost: input.publicHost,
      }),
    );
    console.log(`pie relay listening on ${handle.publicBaseUrl}`);
    console.log(`pie relay control on ${input.publicHost}:${String(handle.controlPort)}`);
    yield* Effect.addFinalizer(() => Effect.promise(() => handle.close()));
    return yield* Effect.never;
  });
