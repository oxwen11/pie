import { describe, expect, it } from "vitest";

import {
  buildSshHostSpec,
  environmentLabel,
  extractJsonObject,
  formatSshInput,
  overlaySshTarget,
  parseRemoteLaunchOutput,
  parseSshInput,
  parseSshResolveOutput,
  remoteStateKey,
  targetConnectionKey,
} from "./target";

describe("parseSshInput", () => {
  it("parses user@host, host:port, and a bare alias", () => {
    expect(parseSshInput("alice@example.com")).toEqual({
      alias: "example.com",
      hostname: "example.com",
      username: "alice",
      port: null,
    });
    expect(parseSshInput("example.com:2222")).toEqual({
      alias: "example.com",
      hostname: "example.com",
      username: null,
      port: 2222,
    });
    expect(parseSshInput("myserver")).toEqual({
      alias: "myserver",
      hostname: "myserver",
      username: null,
      port: null,
    });
  });

  it("parses an IPv6 host in brackets", () => {
    expect(parseSshInput("user@[::1]:2222")).toEqual({
      alias: "::1",
      hostname: "::1",
      username: "user",
      port: 2222,
    });
  });
});

describe("parseSshResolveOutput", () => {
  it("reads hostname, user, and port from ssh -G output", () => {
    const target = parseSshResolveOutput(
      "myserver",
      ["hostname real.example.com", "user alice", "port 2222", "hostname ignored"].join("\n"),
    );
    expect(target).toEqual({
      alias: "myserver",
      hostname: "real.example.com",
      username: "alice",
      port: 2222,
    });
  });
});

describe("overlaySshTarget", () => {
  it("lets the typed username and port win; hostname stays the ssh -G value", () => {
    expect(
      overlaySshTarget(
        { alias: "myserver", hostname: "real.example.com", username: "from-config", port: 22 },
        { alias: "myserver", hostname: "myserver", username: "bob", port: 2222 },
      ),
    ).toEqual({
      alias: "myserver",
      hostname: "real.example.com",
      username: "bob",
      port: 2222,
    });
  });
});

describe("connection identity", () => {
  it("derives a stable 16-hex state key", () => {
    const target = parseSshInput("alice@example.com");
    expect(remoteStateKey(target)).toMatch(/^[0-9a-f]{16}$/u);
    expect(remoteStateKey(target)).toBe(remoteStateKey(target));
    expect(targetConnectionKey(target)).toContain("example.com");
  });

  it("labels an environment as user@host when a username is present", () => {
    expect(environmentLabel(parseSshInput("alice@example.com"))).toBe("alice@example.com");
    expect(environmentLabel(parseSshInput("myserver"))).toBe("myserver");
  });

  it("builds an ssh destination spec without doubling user@", () => {
    expect(buildSshHostSpec(parseSshInput("alice@example.com"))).toBe("alice@example.com");
    expect(buildSshHostSpec(parseSshInput("myserver"))).toBe("myserver");
    expect(
      buildSshHostSpec({
        alias: "myserver",
        hostname: "real.example.com",
        username: "alice",
        port: 22,
      }),
    ).toBe("alice@myserver");
    expect(
      buildSshHostSpec({
        alias: "::1",
        hostname: "::1",
        username: "alice",
        port: 2222,
      }),
    ).toBe("alice@[::1]");
  });

  it("formats a reconnect string that parseSshInput round-trips", () => {
    const typed = parseSshInput("bob@myserver:2222");
    expect(formatSshInput(typed)).toBe("bob@myserver:2222");
    expect(parseSshInput(formatSshInput(typed))).toEqual(typed);
  });
});

describe("parseRemoteLaunchOutput", () => {
  it("reads the last JSON object from mixed stdout", () => {
    expect(
      parseRemoteLaunchOutput(
        'starting\n{"remotePort":41234,"token":"secret-token","serverKind":"daemon"}\n',
      ),
    ).toEqual({
      remotePort: 41234,
      token: "secret-token",
      serverKind: "daemon",
    });
  });

  it("rejects a payload without a daemon token or port", () => {
    expect(
      parseRemoteLaunchOutput('{"remotePort":0,"token":"x","serverKind":"daemon"}'),
    ).toBeUndefined();
    expect(
      parseRemoteLaunchOutput('{"remotePort":4000,"token":"","serverKind":"daemon"}'),
    ).toBeUndefined();
    expect(
      parseRemoteLaunchOutput('{"remotePort":4000,"token":"secret","serverKind":"serve"}'),
    ).toBeUndefined();
  });

  it("extracts the last brace-delimited object", () => {
    expect(extractJsonObject('noise { "a": 1 } more { "b": 2 }')).toBe('{ "b": 2 }');
  });
});
