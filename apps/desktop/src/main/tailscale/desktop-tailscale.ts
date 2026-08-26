import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  ensureTailscaleServe,
  listOnlineTailscaleSshHosts,
  probeTailscaleClient,
  readTailscaleStatus,
  TailscaleClientMissingError,
  tailscaleCommandForPlatform,
  type TailscaleClientAvailability,
  type TailscaleEnvironmentError,
  type TailscalePeerHost,
} from "@getpie/tailscale";
import { Context, Effect, FileSystem, Layer, Ref } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

export type {
  TailscaleClientAvailability,
  TailscaleEnvironmentError,
  TailscalePeerHost,
} from "@getpie/tailscale";
export { TailscaleClientMissingError, TailscaleCommandError } from "@getpie/tailscale";

export type TailscaleSnapshot = {
  readonly client: TailscaleClientAvailability;
  readonly loggedIn: boolean;
  readonly magicDnsName: string | null;
  readonly httpsBaseUrl: string | null;
  readonly serveEnabled: boolean;
};

export type DesktopTailscaleShape = {
  readonly client: TailscaleClientAvailability;
  readonly listSshHosts: Effect.Effect<readonly TailscalePeerHost[]>;
  readonly snapshot: Effect.Effect<TailscaleSnapshot>;
  readonly enableServe: (localPort: number) => Effect.Effect<void, TailscaleEnvironmentError>;
  readonly disableServe: Effect.Effect<void, TailscaleEnvironmentError>;
};

export class DesktopTailscale extends Context.Service<DesktopTailscale, DesktopTailscaleShape>()(
  "desktop/DesktopTailscale",
) {}

export function disabledDesktopTailscale(
  overrides?: Partial<DesktopTailscaleShape>,
): DesktopTailscale["Service"] {
  return DesktopTailscale.of({
    client: { available: true },
    listSshHosts: Effect.succeed([]),
    snapshot: Effect.succeed({
      client: { available: true },
      loggedIn: false,
      magicDnsName: null,
      httpsBaseUrl: null,
      serveEnabled: false,
    }),
    enableServe: () =>
      Effect.fail(
        new TailscaleClientMissingError({
          command: tailscaleCommandForPlatform(),
          message: "Tailscale is disabled.",
        }),
      ),
    disableServe: Effect.void,
    ...overrides,
  });
}

export function portFromHttpBaseUrl(httpBaseUrl: string): number | null {
  try {
    const parsed = new URL(httpBaseUrl);
    if (parsed.port.length > 0) {
      const port = Number.parseInt(parsed.port, 10);
      return Number.isInteger(port) ? port : null;
    }
    if (parsed.protocol === "https:") return 443;
    if (parsed.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}

const emptySnapshot = (
  client: TailscaleClientAvailability,
  serveEnabled = false,
): TailscaleSnapshot => ({
  client,
  loggedIn: false,
  magicDnsName: null,
  httpsBaseUrl: null,
  serveEnabled,
});

export function makeDesktopTailscale(): Effect.Effect<
  DesktopTailscale["Service"],
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const platform = yield* Effect.context<
      FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
    >();
    const client = yield* probeTailscaleClient();
    const serveEnabledRef = yield* Ref.make(false);

    const snapshotFromStatus = (serveEnabled: boolean) =>
      readTailscaleStatus.pipe(
        Effect.map((status) => {
          const magicDnsName = status.magicDnsName;
          return {
            client,
            loggedIn: magicDnsName !== null || status.backendState === "Running",
            magicDnsName,
            httpsBaseUrl:
              magicDnsName === null ? null : buildTailscaleHttpsBaseUrl({ magicDnsName }),
            serveEnabled,
          } satisfies TailscaleSnapshot;
        }),
        Effect.orElseSucceed(() => emptySnapshot(client, serveEnabled)),
      );

    return DesktopTailscale.of({
      client,
      listSshHosts: client.available
        ? listOnlineTailscaleSshHosts.pipe(Effect.provide(platform))
        : Effect.succeed([]),
      snapshot: Effect.gen(function* () {
        if (!client.available) return emptySnapshot(client);
        const serveEnabled = yield* Ref.get(serveEnabledRef);
        return yield* snapshotFromStatus(serveEnabled);
      }).pipe(Effect.provide(platform)),
      enableServe: (localPort) =>
        Effect.gen(function* () {
          if (!client.available) {
            return yield* new TailscaleClientMissingError({
              command: tailscaleCommandForPlatform(),
              message: client.message,
            });
          }
          yield* ensureTailscaleServe({ localPort });
          yield* Ref.set(serveEnabledRef, true);
        }).pipe(Effect.provide(platform)),
      disableServe: Effect.gen(function* () {
        if (!client.available) return;
        yield* disableTailscaleServe();
        yield* Ref.set(serveEnabledRef, false);
      }).pipe(Effect.provide(platform)),
    });
  });
}

export const DesktopTailscaleLive = Layer.effect(DesktopTailscale, makeDesktopTailscale());
