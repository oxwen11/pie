import { Effect, Option, Stream, SubscriptionRef } from "effect";
import { describe, expect, it } from "vitest";

import type { ServerConnection, ServerStatusSnapshot } from "../../shared/desktop-rpc";
import type { LocalServer } from "../server/local-server";
import { disabledDesktopSsh, SshHostDiscoveryError } from "../ssh/desktop-ssh";
import { disabledDesktopTailscale } from "../tailscale/desktop-tailscale";
import { makeDesktopApplication } from "./desktop-application";

const anyOs = expect.stringMatching(/^(macos|windows|linux)$/);

const localConnection: ServerConnection = {
  httpBaseUrl: "http://127.0.0.1:43123",
  wsBaseUrl: "ws://127.0.0.1:43123",
  token: "desktop-token",
};

const sshConnection: ServerConnection = {
  httpBaseUrl: "http://127.0.0.1:51234",
  wsBaseUrl: "ws://127.0.0.1:51234",
  token: "ssh-token",
};

function makeHarness(
  connection: Effect.Effect<ServerConnection> = Effect.succeed(localConnection),
  ssh = disabledDesktopSsh(),
  tailscale = disabledDesktopTailscale(),
) {
  const statusRef = Effect.runSync(
    SubscriptionRef.make<ServerStatusSnapshot>({ revision: 0, status: "ready" }),
  );
  let retries = 0;
  let quits = 0;
  const server: LocalServer["Service"] = {
    connection,
    snapshot: SubscriptionRef.get(statusRef),
    changes: SubscriptionRef.changes(statusRef),
    retry: Effect.sync(() => {
      retries += 1;
    }),
  };
  const application = makeDesktopApplication({
    server,
    ssh,
    tailscale,
    quit: Effect.sync(() => {
      quits += 1;
    }),
  });

  return {
    application,
    setStatus: (snapshot: ServerStatusSnapshot) =>
      Effect.runPromise(SubscriptionRef.set(statusRef, snapshot)),
    retries: () => retries,
    quits: () => quits,
  };
}

describe("DesktopApplication", () => {
  it("exposes the renderer bootstrap without transport dependencies", async () => {
    const h = makeHarness();

    await expect(Effect.runPromise(h.application.bootstrap)).resolves.toEqual({
      status: "ready",
      statusRevision: 0,
      os: anyOs,
      sshClient: { available: true },
      tailscaleClient: { available: true },
      environments: {
        revision: 0,
        connectingLabel: null,
        remotes: [],
      },
    });
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(
      localConnection,
    );

    await Effect.runPromise(h.application.retryServer);
    await Effect.runPromise(h.application.quit);
    expect(h.retries()).toBe(1);
    expect(h.quits()).toBe(1);
  });

  it("bootstraps shell state without waiting for the server connection", async () => {
    const h = makeHarness(Effect.never);

    await expect(Effect.runPromise(h.application.bootstrap)).resolves.toMatchObject({
      status: "ready",
      statusRevision: 0,
    });
  });

  it("streams server revisions newer than the caller has seen", async () => {
    const h = makeHarness();
    const pending = Effect.runPromise(h.application.watchServerStatus(0).pipe(Stream.runHead));

    await h.setStatus({ revision: 1, status: "reconnecting" });

    await expect(pending.then(Option.getOrUndefined)).resolves.toEqual({
      revision: 1,
      status: "reconnecting",
    });
  });

  it("replays the current snapshot when subscribing after a change", async () => {
    const h = makeHarness();
    await h.setStatus({ revision: 1, status: "reconnecting" });

    const head = await Effect.runPromise(h.application.watchServerStatus(0).pipe(Stream.runHead));

    expect(Option.getOrUndefined(head)).toEqual({ revision: 1, status: "reconnecting" });
  });

  it("does not replay revisions the caller has already seen", async () => {
    const h = makeHarness();
    await h.setStatus({ revision: 1, status: "reconnecting" });

    const pending = Effect.runPromise(h.application.watchServerStatus(1).pipe(Stream.runHead));
    await h.setStatus({ revision: 2, status: "ready" });

    await expect(pending.then(Option.getOrUndefined)).resolves.toEqual({
      revision: 2,
      status: "ready",
    });
  });

  it("keeps the window on the local daemon while SSH remotes connect in parallel", async () => {
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        connect: () =>
          Effect.succeed({
            id: "remote-1",
            target: {
              alias: "example.com",
              hostname: "example.com",
              username: "alice",
              port: null,
            },
            connection: sshConnection,
            closed: Effect.never,
          }),
      }),
    );

    await Effect.runPromise(h.application.connectSsh("alice@example.com"));
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(
      localConnection,
    );
    await expect(Effect.runPromise(h.application.environmentSnapshot)).resolves.toMatchObject({
      connectingLabel: null,
      remotes: [
        {
          id: "remote-1",
          label: "alice@example.com",
          alias: "alice@example.com",
        },
      ],
    });
  });

  it("reports a missing OpenSSH client on bootstrap", async () => {
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        client: { available: false, message: "OpenSSH client not found (ssh)." },
      }),
    );

    await expect(Effect.runPromise(h.application.bootstrap)).resolves.toMatchObject({
      sshClient: { available: false, message: "OpenSSH client not found (ssh)." },
    });
  });

  it("merges Tailscale peers into SSH host discovery without failing SSH config", async () => {
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        discoverHosts: Effect.succeed([
          {
            alias: "devbox",
            hostname: "devbox.tailnet.ts.net",
            username: null,
            port: null,
            source: "ssh-config",
          },
        ]),
      }),
      disabledDesktopTailscale({
        listSshHosts: Effect.succeed([
          {
            alias: "devbox.tailnet.ts.net",
            hostname: "devbox.tailnet.ts.net",
            online: true,
          },
          {
            alias: "other.tailnet.ts.net",
            hostname: "other.tailnet.ts.net",
            online: true,
          },
        ]),
      }),
    );

    await expect(Effect.runPromise(h.application.discoverSshHosts)).resolves.toEqual([
      {
        alias: "devbox",
        hostname: "devbox.tailnet.ts.net",
        username: null,
        port: null,
        source: "ssh-config",
      },
      {
        alias: "other.tailnet.ts.net",
        hostname: "other.tailnet.ts.net",
        username: null,
        port: null,
        source: "tailscale",
      },
    ]);
  });

  it("returns Tailscale peers when SSH config discovery fails", async () => {
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        discoverHosts: Effect.fail(
          new SshHostDiscoveryError({
            message: "Failed to discover SSH hosts.",
            cause: new Error("unreadable config"),
          }),
        ),
      }),
      disabledDesktopTailscale({
        listSshHosts: Effect.succeed([
          {
            alias: "other.tailnet.ts.net",
            hostname: "other.tailnet.ts.net",
            online: true,
          },
        ]),
      }),
    );

    await expect(Effect.runPromise(h.application.discoverSshHosts)).resolves.toEqual([
      {
        alias: "other.tailnet.ts.net",
        hostname: "other.tailnet.ts.net",
        username: null,
        port: null,
        source: "tailscale",
      },
    ]);
  });

  it("lists a connected SSH remote without changing the window daemon", async () => {
    const previousToken = "stale-token-must-not-return";
    const restored: ServerConnection = {
      httpBaseUrl: "http://127.0.0.1:52001",
      wsBaseUrl: "ws://127.0.0.1:52001",
      token: "fresh-ssh-token",
    };
    let connects = 0;
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        connect: () =>
          Effect.sync(() => {
            connects += 1;
            return {
              id: "remote-1",
              target: {
                alias: "example.com",
                hostname: "example.com",
                username: "alice",
                port: null,
              },
              connection: restored,
              closed: Effect.never,
            };
          }),
      }),
    );

    await Effect.runPromise(h.application.connectSsh("alice@example.com"));
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(
      localConnection,
    );
    expect(connects).toBe(1);
    expect(restored.token).not.toBe(previousToken);
    await expect(Effect.runPromise(h.application.environmentSnapshot)).resolves.toMatchObject({
      remotes: [{ id: "remote-1" }],
    });
  });

  it("holds more than one SSH forward at once", async () => {
    const other: ServerConnection = {
      httpBaseUrl: "http://127.0.0.1:61234",
      wsBaseUrl: "ws://127.0.0.1:61234",
      token: "ssh-token-2",
    };
    const h = makeHarness(
      Effect.succeed(localConnection),
      disabledDesktopSsh({
        connect: (raw) =>
          Effect.succeed(
            raw.includes("bob")
              ? {
                  id: "remote-2",
                  target: {
                    alias: "other.example",
                    hostname: "other.example",
                    username: "bob",
                    port: null,
                  },
                  connection: other,
                  closed: Effect.never,
                }
              : {
                  id: "remote-1",
                  target: {
                    alias: "example.com",
                    hostname: "example.com",
                    username: "alice",
                    port: null,
                  },
                  connection: sshConnection,
                  closed: Effect.never,
                },
          ),
      }),
    );

    await Effect.runPromise(h.application.connectSsh("alice@example.com"));
    await Effect.runPromise(h.application.connectSsh("bob@other.example"));
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(
      localConnection,
    );
    await expect(Effect.runPromise(h.application.environmentSnapshot)).resolves.toMatchObject({
      remotes: [{ id: "remote-1" }, { id: "remote-2" }],
    });
    const snapshot = await Effect.runPromise(h.application.environmentSnapshot);
    expect(snapshot.remotes.map((remote) => remote.environmentId)).toEqual([
      "remote-1",
      "remote-2",
    ]);
  });
});
