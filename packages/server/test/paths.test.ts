import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  configFilePath,
  daemonStdioLogPath,
  logsDirectory,
  resolveDaemonDirectory,
  resolvePieHome,
  pieLogPath,
} from "../src/config/paths";

describe("resolvePieHome", () => {
  it("prefers an explicit PIE_HOME over any default", () => {
    expect(resolvePieHome({ PIE_HOME: "/tmp/custom", NODE_ENV: "development" })).toBe(
      "/tmp/custom",
    );
  });

  it("defaults to ~/.pie outside development", () => {
    expect(resolvePieHome({})).toBe(path.join(os.homedir(), ".pie"));
    expect(resolvePieHome({ NODE_ENV: "production" })).toBe(path.join(os.homedir(), ".pie"));
  });

  it("defaults to ~/.pie-dev under NODE_ENV=development", () => {
    expect(resolvePieHome({ NODE_ENV: "development" })).toBe(path.join(os.homedir(), ".pie-dev"));
  });

  it("treats an empty PIE_HOME as unset", () => {
    expect(resolvePieHome({ PIE_HOME: "" })).toBe(path.join(os.homedir(), ".pie"));
    expect(resolvePieHome({ PIE_HOME: "   " })).toBe(path.join(os.homedir(), ".pie"));
  });
});

describe("logsDirectory", () => {
  it("is $PIE_HOME/logs, with the process log and daemon stdio named beside it", () => {
    const logsDir = logsDirectory("/tmp/data");
    expect(logsDir).toBe(path.join("/tmp/data", "logs"));
    expect(pieLogPath(logsDir)).toBe(path.join("/tmp/data", "logs", "pie.log"));
    expect(daemonStdioLogPath(logsDir)).toBe(path.join("/tmp/data", "logs", "daemon-stdio.log"));
  });
});

describe("configFilePath", () => {
  it("is $PIE_HOME/config.toml, not under storage/", () => {
    expect(configFilePath("/tmp/data")).toBe(path.join("/tmp/data", "config.toml"));
  });
});

describe("resolveDaemonDirectory", () => {
  it("prefers an explicit PIE_DAEMON_DIR", () => {
    expect(
      resolveDaemonDirectory({
        PIE_HOME: "/tmp/data",
        PIE_DAEMON_DIR: "/tmp/daemon-state",
      }),
    ).toBe("/tmp/daemon-state");
  });

  it("defaults to the daemon directory under PIE_HOME", () => {
    expect(resolveDaemonDirectory({ PIE_HOME: "/tmp/data" })).toBe(
      path.join("/tmp/data", "daemon"),
    );
  });

  it("follows the development PIE_HOME default", () => {
    expect(resolveDaemonDirectory({ NODE_ENV: "development" })).toBe(
      path.join(os.homedir(), ".pie-dev", "daemon"),
    );
  });

  it("treats an empty PIE_DAEMON_DIR as unset", () => {
    expect(resolveDaemonDirectory({ PIE_HOME: "/tmp/data", PIE_DAEMON_DIR: "" })).toBe(
      path.join("/tmp/data", "daemon"),
    );
    expect(resolveDaemonDirectory({ PIE_HOME: "/tmp/data", PIE_DAEMON_DIR: "  " })).toBe(
      path.join("/tmp/data", "daemon"),
    );
  });
});
