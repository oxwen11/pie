import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { CLI } from "../identity.ts";
import { readRunMeta, writeRunMeta } from "../meta.ts";
import { currentRun, setCurrentRun } from "../runtime/fs.ts";
import { findRepoRoot } from "../runtime/process.ts";
import type { Surface } from "../surface.ts";
import { cleanup } from "./cleanup.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cleanup-test-"));
  roots.push(root);
  const identity = { ...CLI, root, currentLink: path.join(root, "current") };
  const stop = vi.fn<Surface["stop"]>(async () => {});
  const surface = {
    identity,
    stop,
    spawn: vi.fn<Surface["spawn"]>(),
    probe: vi.fn<Surface["probe"]>(),
  };
  const create = (name: string) => {
    const dir = path.join(root, "runs", name);
    writeRunMeta(path.join(dir, "meta.json"), {
      surface: "cli",
      mode: "serve",
      repo: findRepoRoot(),
      runId: name,
      pieHome: path.join(dir, "pie-home"),
      piePort: 4182,
      startedAt: "2026-09-30T00:00:00Z",
    });
    return fs.realpathSync(dir);
  };
  return { root, identity, surface, stop, create };
}

it("cleans the explicit run without stopping or clearing another current run", async () => {
  const { identity, surface, stop, create } = fixture();
  const old = create("old");
  const active = create("active");
  setCurrentRun(identity.currentLink, active);

  await cleanup(surface, [old]);

  expect(stop).toHaveBeenCalledExactlyOnceWith(old, expect.objectContaining({ runId: "old" }));
  expect(fs.existsSync(old)).toBe(false);
  expect(currentRun(identity.currentLink)).toBe(active);
  expect(fs.existsSync(active)).toBe(true);
  await cleanup(surface, []);
  expect(currentRun(identity.currentLink)).toBeUndefined();
});

it("refuses a foreign root, a missing explicit run, and corrupt metadata before stopping anything", async () => {
  const owned = fixture();
  const foreign = fixture();
  const active = owned.create("active");
  setCurrentRun(owned.identity.currentLink, active);

  await expect(cleanup(owned.surface, [foreign.create("foreign")])).rejects.toThrow(/root/);
  await expect(cleanup(owned.surface, [path.join(owned.root, "missing")])).rejects.toThrow(/exist/);
  const linked = path.join(owned.root, "runs", "foreign-link");
  fs.symlinkSync(foreign.create("linked"), linked);
  await expect(cleanup(owned.surface, [linked])).rejects.toThrow(/root/);
  const wrongOwner = owned.create("wrong-owner");
  const metaPath = path.join(wrongOwner, "meta.json");
  writeRunMeta(metaPath, { ...readRunMeta(metaPath), repo: foreign.root });
  await expect(cleanup(owned.surface, [wrongOwner])).rejects.toThrow(/worktree/);
  const broken = owned.create("broken");
  fs.writeFileSync(path.join(broken, "meta.json"), "broken");
  await expect(cleanup(owned.surface, [broken])).rejects.toThrow(/JSON/);
  expect(owned.stop).not.toHaveBeenCalled();
  expect(currentRun(owned.identity.currentLink)).toBe(active);
});
