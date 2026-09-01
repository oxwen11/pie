import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { patchRunMeta, readRunMeta, writeRunMeta, type WebRunMeta } from "./meta.ts";

function webMeta(): WebRunMeta {
  return {
    surface: "web",
    runId: "run-1",
    repo: "/repo",
    pieHome: "/tmp/pie-verify-web/runs/run-1/pie-home",
    piePort: 4180,
    vitePort: 4190,
    appUrl: "http://localhost:4190/",
    sampleProject: "/home/me/verify-pie-sample",
    createdSample: true,
    startedAt: "2026-09-01T00:00:00Z",
  };
}

describe("readRunMeta", () => {
  it("round-trips a web meta document", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-meta-"));
    const file = path.join(dir, "meta.json");
    const meta = webMeta();
    writeRunMeta(file, meta);
    expect(readRunMeta(file)).toEqual(meta);
  });

  it("rejects a document without a surface", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-meta-"));
    const file = path.join(dir, "meta.json");
    fs.writeFileSync(file, `${JSON.stringify({ runId: "x", piePort: 4180 })}\n`);
    expect(() => readRunMeta(file)).toThrow(/invalid surface/);
  });

  it("rejects a type mismatch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-meta-"));
    const file = path.join(dir, "meta.json");
    writeRunMeta(file, webMeta());
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    raw.piePort = "4180";
    fs.writeFileSync(file, `${JSON.stringify(raw)}\n`);
    expect(() => readRunMeta(file)).toThrow(/piePort/);
  });

  it("refuses to change surface on patch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-verify-meta-"));
    const file = path.join(dir, "meta.json");
    writeRunMeta(file, webMeta());
    expect(() => patchRunMeta(file, { surface: "cli" })).toThrow(/cannot change surface/);
  });
});
