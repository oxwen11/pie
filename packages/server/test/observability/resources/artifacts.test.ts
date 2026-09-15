import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveResourceArtifacts } from "../../../src/observability/resources/artifacts";

describe("resolveResourceArtifacts", () => {
  it("locates the native monitor beside the exported worker, including unpacked asar paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-resource-artifacts-"));
    const directory = path.join(root, "app.asar.unpacked", "dist", "resources");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "writer-worker.mjs"), "");
    fs.writeFileSync(path.join(directory, "resource-monitor"), "");

    const artifacts = resolveResourceArtifacts({
      resolve: (specifier) =>
        specifier === "@getpie/server/resource-writer"
          ? path.join(root, "app.asar", "dist", "resources", "writer-worker.mjs")
          : undefined,
      platform: "darwin",
    });

    expect(artifacts?.workerEntry.pathname).toContain("app.asar.unpacked");
    expect(artifacts?.monitorCommand).toBe(path.join(directory, "resource-monitor"));
    fs.rmSync(root, { recursive: true });
  });

  it("falls back to packaged extra resources when the exported asar copy is not unpacked", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-resource-artifacts-"));
    const directory = path.join(root, "resources");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "writer-worker.mjs"), "");
    fs.writeFileSync(path.join(directory, "resource-monitor"), "");

    const artifacts = resolveResourceArtifacts({
      resolve: (specifier) =>
        specifier === "@getpie/server/resource-writer"
          ? path.join(root, "app.asar", "node_modules", "writer-worker.mjs")
          : undefined,
      fallbackDirectory: directory,
      platform: "darwin",
    });

    expect(artifacts?.workerEntry.pathname).toBe(path.join(directory, "writer-worker.mjs"));
    expect(artifacts?.monitorCommand).toBe(path.join(directory, "resource-monitor"));
    fs.rmSync(root, { recursive: true });
  });
});
