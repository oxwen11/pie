import { describe, expect, it } from "vitest";

import type { ServerConnection } from "@/server-connection";

import { createEnvironmentClients } from "./environment-clients";
import { createAppClients, disposeAppClients } from "./orpc";

const connection = (port: number, token = "tok"): ServerConnection => ({
  httpBaseUrl: `http://127.0.0.1:${port}`,
  wsBaseUrl: `ws://127.0.0.1:${port}`,
  token,
});

describe("createEnvironmentClients", () => {
  it("returns the local bag for localId", () => {
    const local = createAppClients();
    const registry = createEnvironmentClients({
      localId: "env-local",
      local,
      resolveRemote: () => undefined,
    });
    expect(registry.get("env-local")).toBe(local);
    disposeAppClients(local);
  });

  it("mints and caches a remote bag", () => {
    const local = createAppClients();
    const remote = connection(5001);
    const registry = createEnvironmentClients({
      localId: "env-local",
      local,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
    });

    const first = registry.get("env-remote");
    const second = registry.get("env-remote");
    expect(first).toBe(second);
    expect(first).not.toBe(local);

    registry.prune(new Map());
    disposeAppClients(local);
  });

  it("throws when the remote is not connected", () => {
    const local = createAppClients();
    const registry = createEnvironmentClients({
      localId: "env-local",
      local,
      resolveRemote: () => undefined,
    });
    expect(() => registry.get("missing")).toThrow(/Environment missing is not connected/);
    disposeAppClients(local);
  });

  it("remints when the connection key changes", () => {
    const local = createAppClients();
    let remote = connection(5001, "a");
    const registry = createEnvironmentClients({
      localId: "env-local",
      local,
      resolveRemote: (id) => (id === "env-remote" ? remote : undefined),
    });

    const first = registry.get("env-remote");
    remote = connection(5001, "b");
    const second = registry.get("env-remote");

    expect(second).not.toBe(first);

    registry.prune(new Map());
    disposeAppClients(local);
  });

  it("prune drops missing and key-changed remotes", () => {
    const local = createAppClients();
    const registry = createEnvironmentClients({
      localId: "env-local",
      local,
      resolveRemote: (id) => {
        if (id === "keep") return connection(1, "k");
        if (id === "rotate") return connection(2, "old");
        if (id === "gone") return connection(3, "g");
        return undefined;
      },
    });

    const keep = registry.get("keep");
    registry.get("rotate");
    registry.get("gone");

    const seen: string[] = [];
    registry.prune(
      new Map([
        ["keep", connection(1, "k")],
        ["rotate", connection(2, "new")],
      ]),
      (id) => {
        seen.push(id);
      },
    );

    expect([...seen].sort()).toEqual(["gone", "rotate"]);
    expect(registry.get("keep")).toBe(keep);
    // dropped from cache; next get remints from resolveRemote
    expect(registry.get("rotate")).not.toBe(keep);

    registry.prune(new Map());
    disposeAppClients(local);
  });
});
