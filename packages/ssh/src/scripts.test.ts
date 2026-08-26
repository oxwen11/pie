import { describe, expect, it } from "vitest";

import {
  buildRemoteLaunchScript,
  buildRemotePieRunnerScript,
  DEFAULT_NODE_ENGINE_RANGE,
} from "./scripts";

describe("remote launch scripts", () => {
  it("starts or attaches the remote pie daemon and prints launch JSON", () => {
    const script = buildRemoteLaunchScript();
    expect(script).toContain("unset NODE_ENV PIE_HOME PIE_DAEMON_DIR PIE_AUTH_TOKEN");
    expect(script).toContain("daemon start");
    expect(script).toContain("$HOME/.pie/daemon/daemon.pid");
    expect(script).toContain("$HOME/.pie/ssh-launch/");
    expect(script).toContain('serverKind: "daemon"');
    expect(script).not.toContain("@@PIE_");
  });

  it("prefers a PATH pie, then npx @getpie/cli", () => {
    const runner = buildRemotePieRunnerScript();
    expect(runner).toContain("command -v pie");
    expect(runner).toContain("@getpie/cli@latest");
    expect(runner).toContain("ensure_remote_node_path");
    expect(runner).toContain(DEFAULT_NODE_ENGINE_RANGE);
  });

  it("embeds the Node 24 engine check", () => {
    const script = buildRemoteLaunchScript({ nodeEngineRange: DEFAULT_NODE_ENGINE_RANGE });
    expect(script).toContain("major !== 24");
    expect(script).toContain("VOLTA_HOME");
    expect(script).toContain("nvm.sh");
  });
});
