import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveResourceArtifacts } from "../../../src/observability/resources/artifacts";

describe("resolveResourceArtifacts", () => {
  it("locates the native monitor from the package export, including unpacked asar paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-resource-artifacts-"));
    const directory = path.join(root, "app.asar.unpacked", "dist", "resources");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "resource-monitor"), "");

    const artifacts = resolveResourceArtifacts({
      resolve: (specifier) =>
        specifier === "@getpie/server/resource-monitor"
          ? path.join(root, "app.asar", "dist", "resources", "resource-monitor")
          : undefined,
      platform: "darwin",
    });

    expect(artifacts?.monitorCommand).toBe(path.join(directory, "resource-monitor"));
    fs.rmSync(root, { recursive: true });
  });

  it("falls back to packaged extra resources when the exported asar copy is not unpacked", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-resource-artifacts-"));
    const directory = path.join(root, "resources");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "resource-monitor"), "");

    const artifacts = resolveResourceArtifacts({
      resolve: () => path.join(root, "app.asar", "node_modules", "resource-monitor"),
      fallbackDirectory: directory,
      platform: "darwin",
    });

    expect(artifacts?.monitorCommand).toBe(path.join(directory, "resource-monitor"));
    fs.rmSync(root, { recursive: true });
  });
});
