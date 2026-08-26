import { Effect, Option, Stream, SubscriptionRef } from "effect";
import { describe, expect, it } from "vitest";

import {
  LOCAL_ENVIRONMENT_ID,
  type ServerConnection,
  type ServerStatusSnapshot,
} from "../../shared/desktop-rpc";
import type { LocalServer } from "../server/local-server";
import { disabledDesktopSsh } from "../ssh/desktop-ssh";
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
    initialRemotes: [],
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
        activeId: LOCAL_ENVIRONMENT_ID,
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

  it("switches serverConnection to the forwarded SSH endpoint and back to local", async () => {
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
          }),
      }),
    );

    await Effect.runPromise(h.application.connectSsh("alice@example.com"));
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(sshConnection);
    await expect(Effect.runPromise(h.application.environmentSnapshot)).resolves.toMatchObject({
      activeId: "remote-1",
      connectingLabel: null,
      remotes: [
        {
          id: "remote-1",
          label: "alice@example.com",
          alias: "alice@example.com",
          status: "ready",
        },
      ],
    });

    await Effect.runPromise(h.application.disconnectSsh);
    await expect(Effect.runPromise(h.application.serverConnection)).resolves.toEqual(
      localConnection,
    );
    await expect(Effect.runPromise(h.application.environmentSnapshot)).resolves.toMatchObject({
      activeId: LOCAL_ENVIRONMENT_ID,
      remotes: [{ id: "remote-1", status: "idle" }],
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
});
