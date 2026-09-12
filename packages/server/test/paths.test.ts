import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  daemonDirectory,
  daemonStdioLogPath,
  defaultPieHomeDir,
  logsDirectory,
  resolveDaemonDirectory,
  resolvePieHome,
  resourceSourceDirectory,
  pieLogPath,
} from "../src/config/paths";

describe("defaultPieHomeDir", () => {
  it("uses .pie when the binary is not in a Git checkout", () => {
    expect(defaultPieHomeDir({ inGit: false })).toBe(".pie");
  });

  it("uses .pie_<branch>, encoding slashes as --", () => {
    expect(defaultPieHomeDir({ inGit: true, branch: "main" })).toBe(".pie_main");
    expect(defaultPieHomeDir({ inGit: true, branch: "feat/pie-home" })).toBe(".pie_feat--pie-home");
    expect(defaultPieHomeDir({ inGit: true, branch: "feat-pie-home" })).toBe(".pie_feat-pie-home");
  });

  it("falls back to .pie_dev when the checkout has no readable branch", () => {
    expect(defaultPieHomeDir({ inGit: true, branch: undefined })).toBe(".pie_dev");
  });
});

describe("resolvePieHome", () => {
  it("prefers an explicit PIE_HOME over any default", () => {
    expect(resolvePieHome({ PIE_HOME: "/tmp/custom" })).toBe("/tmp/custom");
  });

  it("treats an empty PIE_HOME as unset", () => {
    expect(resolvePieHome({ PIE_HOME: "" })).toBe(resolvePieHome({}));
    expect(resolvePieHome({ PIE_HOME: "   " })).toBe(resolvePieHome({}));
  });
});

describe("daemonDirectory", () => {
  it("is always $PIE_HOME/daemon", () => {
    expect(daemonDirectory("/tmp/data")).toBe(path.join("/tmp/data", "daemon"));
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

describe("resourceSourceDirectory", () => {
  it("keeps each source under $PIE_HOME/logs/resources", () => {
    const logsDir = logsDirectory("/tmp/data");
    expect(resourceSourceDirectory(logsDir, "os")).toBe(
      path.join("/tmp/data", "logs", "resources", "os"),
    );
    expect(resourceSourceDirectory(logsDir, "daemon")).toBe(
      path.join("/tmp/data", "logs", "resources", "daemon"),
    );
    expect(resourceSourceDirectory(logsDir, "electron")).toBe(
      path.join("/tmp/data", "logs", "resources", "electron"),
    );
  });
});

describe("resolveDaemonDirectory", () => {
  it("is the daemon directory under PIE_HOME", () => {
    expect(resolveDaemonDirectory({ PIE_HOME: "/tmp/data" })).toBe(
      path.join("/tmp/data", "daemon"),
    );
  });

  it("ignores PIE_DAEMON_DIR", () => {
    expect(
      resolveDaemonDirectory({
        PIE_HOME: "/tmp/data",
        PIE_DAEMON_DIR: "/tmp/daemon-state",
      }),
    ).toBe(path.join("/tmp/data", "daemon"));
  });
});
